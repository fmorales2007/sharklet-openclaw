// Schemas and guards for the typed RPC layer (F1-06). Everything that crosses
// `rpcCall` is checked here, in both directions. Reuses the gateway protocol's
// own TypeBox schemas where they exist; the rest are written below with
// `Value.Check` (no `Compile`: it generates code and fights the CSP).
// Errors carry a path and a rule, never the offending value.
import { Type, type TSchema } from "typebox";
import { Value } from "typebox/value";
import {
  AgentsListParamsSchema,
  AgentsListResultSchema,
} from "../../../packages/gateway-protocol/src/schema/agents-models-skills.js";
import {
  CronJobSchema,
  CronListParamsSchema,
} from "../../../packages/gateway-protocol/src/schema/cron.js";
import { SessionsListParamsSchema } from "../../../packages/gateway-protocol/src/schema/sessions-list.js";
import { SessionRowSchema } from "../../../packages/gateway-protocol/src/schema/sessions-row.js";
import type { RpcMethod, RpcResultOf } from "./rpc.ts";

// Hard ceilings on top of the schemas, so a field nobody bounded still cannot
// carry an unbounded blob into the page.
const PARAMS_LIMITS = { maxString: 4096, maxArray: 256, maxDepth: 8 };
const RESULT_LIMITS = { maxString: 65_536, maxArray: 2000, maxDepth: 16 };

type Limits = typeof PARAMS_LIMITS;

/** Path and rule of the first value over a ceiling, or null. */
function findOverLimit(value: unknown, limits: Limits, path = "", depth = 0): string | null {
  if (typeof value === "string") {
    return value.length > limits.maxString ? `${path || "/"}: maxLength` : null;
  }
  if (value === null || typeof value !== "object") {
    return null;
  }
  if (depth >= limits.maxDepth) {
    return `${path || "/"}: maxDepth`;
  }
  if (Array.isArray(value)) {
    if (value.length > limits.maxArray) {
      return `${path || "/"}: maxItems`;
    }
    for (let i = 0; i < value.length; i++) {
      const hit = findOverLimit(value[i], limits, `${path}/${i}`, depth + 1);
      if (hit) {
        return hit;
      }
    }
    return null;
  }
  for (const [key, item] of Object.entries(value)) {
    const hit = findOverLimit(item, limits, `${path}/${key}`, depth + 1);
    if (hit) {
      return hit;
    }
  }
  return null;
}

// ---- cero llaves en el cliente ---------------------------------------------

// Exact names only: `totalTokens`, `key` and `sessionKey` are not secrets.
const SECRET_FIELD_NAMES = new Set([
  "apikey",
  "secret",
  "clientsecret",
  "password",
  "token",
  "accesstoken",
  "refreshtoken",
  "authtoken",
  "privatekey",
  "authorization",
  "bearer",
]);

const KEY_SHAPED_VALUES = [
  /\bsk-[A-Za-z0-9_-]{16,}/, // OpenAI, OpenRouter, Anthropic
  /\bgh[pousr]_[A-Za-z0-9]{20,}/,
  /\bgithub_pat_[A-Za-z0-9_]{20,}/,
  /\bxox[abprs]-[A-Za-z0-9-]{10,}/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\beyJ[\w-]+\.[\w-]+\.[\w-]+/, // JWT
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
];

/** Path of the first field that looks like a key (by name or by value), or null. */
export function findKeyShapedField(value: unknown, path = "", depth = 0): string | null {
  if (typeof value === "string") {
    return KEY_SHAPED_VALUES.some((re) => re.test(value)) ? path || "/" : null;
  }
  if (value === null || typeof value !== "object" || depth > 24) {
    return null;
  }
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      const hit = findKeyShapedField(value[i], `${path}/${i}`, depth + 1);
      if (hit) {
        return hit;
      }
    }
    return null;
  }
  for (const [key, item] of Object.entries(value)) {
    const here = `${path}/${key}`;
    if (SECRET_FIELD_NAMES.has(key.replace(/[-_]/g, "").toLowerCase())) {
      return here;
    }
    const hit = findKeyShapedField(item, here, depth + 1);
    if (hit) {
      return hit;
    }
  }
  return null;
}

// ---- esquemas --------------------------------------------------------------

const closed = <T extends Record<string, TSchema>>(properties: T) =>
  Type.Object(properties, { additionalProperties: false });
const str = (maxLength = 256) => Type.String({ maxLength });
const day = () => Type.String({ pattern: "^\\d{4}-\\d{2}-\\d{2}$", maxLength: 10 });

const UsageCostParamsSchema = closed({
  startDate: day(),
  endDate: day(),
  agentScope: Type.Optional(Type.Literal("all")),
  agentId: Type.Optional(str(128)),
  mode: Type.Optional(Type.Union([Type.Literal("utc"), Type.Literal("specific")])),
  utcOffset: Type.Optional(str(16)),
  timeZone: Type.Optional(str(64)),
});

const num = () => Type.Number();
const usageTotalsProperties = {
  input: num(),
  output: num(),
  cacheRead: num(),
  cacheWrite: num(),
  totalTokens: num(),
  totalCost: num(),
  inputCost: num(),
  outputCost: num(),
  cacheReadCost: num(),
  cacheWriteCost: num(),
  missingCostEntries: num(),
  missingCostByModel: Type.Optional(Type.Record(Type.String({ maxLength: 256 }), num())),
};
const UsageTotalsSchema = closed(usageTotalsProperties);
const UsageCostResultSchema = closed({
  updatedAt: num(),
  days: num(),
  daily: Type.Array(closed({ ...usageTotalsProperties, date: day() }), { maxItems: 400 }),
  totals: UsageTotalsSchema,
  cacheStatus: Type.Optional(
    closed({
      status: Type.Union([
        Type.Literal("fresh"),
        Type.Literal("partial"),
        Type.Literal("stale"),
        Type.Literal("refreshing"),
      ]),
      cachedFiles: num(),
      pendingFiles: num(),
      staleFiles: num(),
      refreshedAt: Type.Optional(num()),
    }),
  ),
});

const CronListResultSchema = closed({
  jobs: Type.Array(CronJobSchema, { maxItems: 500 }),
  snapshotRevision: str(),
  total: Type.Integer({ minimum: 0 }),
  limit: Type.Integer({ minimum: 0 }),
  offset: Type.Integer({ minimum: 0 }),
  nextOffset: Type.Union([Type.Integer({ minimum: 0 }), Type.Null()]),
  hasMore: Type.Boolean(),
});

// Session rows and the list envelope grow with the gateway. They are checked
// field by field and then projected: what the contract does not name never
// reaches a page. The wire-only fields below are the ones the contract reads.
const SessionRowFieldsSchema = Type.Object(
  {
    ...SessionRowSchema.properties,
    hasActiveRun: Type.Optional(Type.Boolean()),
    activeRunIds: Type.Optional(Type.Array(str(), { maxItems: 64 })),
    startedAt: Type.Optional(Type.Number()),
    endedAt: Type.Optional(Type.Number()),
    runtimeMs: Type.Optional(Type.Number()),
  },
  { additionalProperties: true },
);
const SessionsListEnvelopeSchema = Type.Object(
  {
    ts: num(),
    path: str(1024),
    count: Type.Integer({ minimum: 0 }),
    totalCount: Type.Optional(Type.Integer({ minimum: 0 })),
    limitApplied: Type.Optional(Type.Integer({ minimum: 0 })),
    offset: Type.Optional(Type.Integer({ minimum: 0 })),
    nextOffset: Type.Optional(Type.Union([Type.Integer({ minimum: 0 }), Type.Null()])),
    hasMore: Type.Optional(Type.Boolean()),
    defaults: Type.Object(
      {
        modelProvider: Type.Union([str(), Type.Null()]),
        model: Type.Union([str(), Type.Null()]),
        contextTokens: Type.Union([num(), Type.Null()]),
      },
      { additionalProperties: true },
    ),
    sessions: Type.Array(SessionRowFieldsSchema, { maxItems: 1000 }),
  },
  { additionalProperties: true },
);

function pick(source: Record<string, unknown>, keys: string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of keys) {
    if (key in source) {
      out[key] = source[key];
    }
  }
  return out;
}

const SESSION_ROW_KEYS = Object.keys(SessionRowFieldsSchema.properties);
const SESSION_ENVELOPE_KEYS = Object.keys(SessionsListEnvelopeSchema.properties);
const SESSION_DEFAULTS_KEYS = ["modelProvider", "model", "contextTokens"];

function projectSessionsList(value: unknown): unknown {
  const list = value as Record<string, unknown>;
  const rows = list.sessions as Record<string, unknown>[];
  return {
    ...pick(list, SESSION_ENVELOPE_KEYS),
    defaults: pick(list.defaults as Record<string, unknown>, SESSION_DEFAULTS_KEYS),
    sessions: rows.map((row) => pick(row, SESSION_ROW_KEYS)),
  };
}

const PagesStateResultSchema = closed({
  off: Type.Array(closed({ id: str(40), reason: Type.Optional(str(200)) }), { maxItems: 64 }),
});

const METHOD_SCHEMAS = {
  "sessions.list": {
    params: SessionsListParamsSchema,
    result: SessionsListEnvelopeSchema,
    project: projectSessionsList,
  },
  "cron.list": { params: CronListParamsSchema, result: CronListResultSchema },
  "usage.cost": { params: UsageCostParamsSchema, result: UsageCostResultSchema },
  "agents.list": { params: AgentsListParamsSchema, result: AgentsListResultSchema },
  "pages.state": { params: closed({}), result: PagesStateResultSchema },
} satisfies Record<
  RpcMethod,
  { params: TSchema; result: TSchema; project?: (v: unknown) => unknown }
>;

function firstSchemaError(schema: TSchema, value: unknown): string {
  const [error] = Value.Errors(schema, value);
  if (!error) {
    return "/: invalid";
  }
  const path = (error as { instancePath?: string }).instancePath || "/";
  return `${path}: ${(error as { keyword?: string }).keyword ?? "invalid"}`;
}

/** Why `params` are not acceptable for `method`, or null. Never includes values. */
export function validateParams(method: RpcMethod, params: unknown): string | null {
  const over = findOverLimit(params, PARAMS_LIMITS);
  if (over) {
    return over;
  }
  const schema = METHOD_SCHEMAS[method].params;
  return Value.Check(schema, params) ? null : firstSchemaError(schema, params);
}

/** The checked, projected response, or the path and rule that failed. */
export function validateResult<M extends RpcMethod>(
  method: M,
  payload: unknown,
): { ok: true; value: RpcResultOf<M> } | { ok: false; detail: string } {
  const over = findOverLimit(payload, RESULT_LIMITS);
  if (over) {
    return { ok: false, detail: over };
  }
  const entry: { result: TSchema; project?: (v: unknown) => unknown } = METHOD_SCHEMAS[method];
  if (!Value.Check(entry.result, payload)) {
    return { ok: false, detail: firstSchemaError(entry.result, payload) };
  }
  const leak = findKeyShapedField(payload);
  if (leak) {
    return { ok: false, detail: `${leak}: key-shaped field` };
  }
  return { ok: true, value: (entry.project ? entry.project(payload) : payload) as RpcResultOf<M> };
}

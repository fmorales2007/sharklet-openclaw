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
import { CronListParamsSchema } from "../../../packages/gateway-protocol/src/schema/cron.js";
import { SessionsListParamsSchema } from "../../../packages/gateway-protocol/src/schema/sessions-list.js";
import { SessionRowSchema } from "../../../packages/gateway-protocol/src/schema/sessions-row.js";
import { SessionsCreateResultSchema } from "../../../packages/gateway-protocol/src/schema/sessions.js";
import type { RpcMethod, RpcResultOf } from "./rpc.ts";

// Hard ceilings on top of the schemas, so a field nobody bounded still cannot
// carry an unbounded blob into the page.
const PARAMS_LIMITS = { maxString: 4096, maxArray: 256, maxDepth: 8 };
const RESULT_LIMITS = { maxString: 65_536, maxArray: 2000, maxDepth: 16 };

type Limits = typeof PARAMS_LIMITS;

// Agent files carry whole documents, so their calls get their own ceilings. They
// stay finite: AGENTS.md and MEMORY.md are capped at the runtime's per-file
// bootstrap size (20,000 characters) and the slack covers a file edited by hand.
const AGENT_FILE_PARAMS_LIMITS: Limits = { ...PARAMS_LIMITS, maxString: 24_000 };
const AGENT_FILE_RESULT_LIMITS: Limits = { ...RESULT_LIMITS, maxString: 262_144 };
const PARAMS_LIMITS_BY_METHOD: Partial<Record<RpcMethod, Limits>> = {
  "agents.files.set": AGENT_FILE_PARAMS_LIMITS,
};
const RESULT_LIMITS_BY_METHOD: Partial<Record<RpcMethod, Limits>> = {
  "agents.files.get": AGENT_FILE_RESULT_LIMITS,
  "agents.files.set": AGENT_FILE_RESULT_LIMITS,
};

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

// ---- no keys in the client --------------------------------------------------

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

// ---- schemas ----------------------------------------------------------------

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

// cron.list rows are more than the protocol's closed CronJobSchema: the read
// view adds effectiveAgentId and flattened run fields (src/gateway/server-methods/
// cron.ts, cronJobReadView), and the scheduler keeps counters of its own in
// `state`. Up next reads a few fields: those are checked and kept, the rest is
// dropped, as with session rows.
const UpNextJobSchema = Type.Object(
  {
    id: str(),
    name: str(1024),
    enabled: Type.Boolean(),
    agentId: Type.Optional(str()),
    state: Type.Optional(
      Type.Object(
        { nextRunAtMs: Type.Optional(num()), runningAtMs: Type.Optional(num()) },
        { additionalProperties: true },
      ),
    ),
  },
  { additionalProperties: true },
);
const CronListResultSchema = Type.Object(
  { jobs: Type.Array(UpNextJobSchema, { maxItems: 500 }), total: Type.Integer({ minimum: 0 }) },
  { additionalProperties: true },
);

function projectCronList(value: unknown): unknown {
  const list = value as { jobs: Record<string, unknown>[]; total: number };
  return {
    total: list.total,
    jobs: list.jobs.map((job) => {
      const kept = pick(job, ["id", "name", "enabled", "agentId"]);
      if (job.state) {
        kept.state = pick(job.state as Record<string, unknown>, ["nextRunAtMs", "runningAtMs"]);
      }
      return kept;
    }),
  };
}

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

// The composer creates the session bare (F2-01): the first message and any
// attachment go through chat.send, because PARAMS_LIMITS.maxString would
// reject them here and a retried create must not carry a turn.
const ChatSessionsCreateParamsSchema = closed({
  idempotencyKey: str(128),
  agentId: str(128),
  model: Type.Optional(str()),
  thinkingLevel: Type.Optional(str(32)),
  memoryless: Type.Optional(Type.Literal(true)),
});

function projectSessionsCreate(value: unknown): unknown {
  const created = value as { entry?: Record<string, unknown> };
  const out = pick(created as Record<string, unknown>, ["key", "sessionId"]);
  if (created.entry) {
    out.entry = pick(created.entry, ["memoryless"]);
  }
  return out;
}

const PagesStateResultSchema = closed({
  off: Type.Array(closed({ id: str(40), reason: Type.Optional(str(200)) }), { maxItems: 256 }),
});

// The files You writes. Anything else in the workspace stays out of this layer.
export const YOU_FILE_NAMES = ["USER.md", "AGENTS.md", "MEMORY.md"] as const;
const YouFileNameSchema = Type.Union(YOU_FILE_NAMES.map((name) => Type.Literal(name)));
const agentId = () => Type.String({ minLength: 1, maxLength: 128 });

const AgentFilesGetParamsSchema = closed({ agentId: agentId(), name: YouFileNameSchema });
const AgentFilesSetParamsSchema = closed({
  agentId: agentId(),
  name: YouFileNameSchema,
  content: Type.String({ maxLength: 20_000 }),
  expectedHash: Type.Optional(Type.String({ pattern: "^[0-9a-fA-F]{64}$", maxLength: 64 })),
});

// The gateway entry also carries the workspace path and mtime; the page needs
// neither, so they are checked loosely and dropped.
const AgentFileEntrySchema = Type.Object(
  {
    name: YouFileNameSchema,
    missing: Type.Boolean(),
    size: Type.Optional(Type.Number()),
    hash: Type.Optional(Type.String({ maxLength: 64 })),
    content: Type.Optional(Type.String()),
  },
  { additionalProperties: true },
);
const AgentFileResultSchema = Type.Object(
  { agentId: agentId(), file: AgentFileEntrySchema },
  { additionalProperties: true },
);

function projectAgentFile(value: unknown): unknown {
  const result = value as { agentId: string; file: Record<string, unknown> };
  return {
    agentId: result.agentId,
    file: pick(result.file, ["name", "missing", "size", "hash", "content"]),
  };
}

const AgentsUpdateParamsSchema = closed({
  agentId: agentId(),
  model: Type.Optional(Type.Union([str(), Type.Null()])),
  thinkingDefault: Type.Optional(Type.Union([str(32), Type.Null()])),
});
const AgentsUpdateResultSchema = closed({ ok: Type.Literal(true), agentId: agentId() });

const METHOD_SCHEMAS = {
  "sessions.create": {
    params: ChatSessionsCreateParamsSchema,
    result: SessionsCreateResultSchema,
    project: projectSessionsCreate,
  },
  "sessions.list": {
    params: SessionsListParamsSchema,
    result: SessionsListEnvelopeSchema,
    project: projectSessionsList,
  },
  "cron.list": {
    params: CronListParamsSchema,
    result: CronListResultSchema,
    project: projectCronList,
  },
  "usage.cost": { params: UsageCostParamsSchema, result: UsageCostResultSchema },
  "agents.list": { params: AgentsListParamsSchema, result: AgentsListResultSchema },
  "pages.state": { params: closed({}), result: PagesStateResultSchema },
  "agents.files.get": {
    params: AgentFilesGetParamsSchema,
    result: AgentFileResultSchema,
    project: projectAgentFile,
  },
  "agents.files.set": {
    params: AgentFilesSetParamsSchema,
    result: AgentFileResultSchema,
    project: projectAgentFile,
  },
  "agents.update": { params: AgentsUpdateParamsSchema, result: AgentsUpdateResultSchema },
} satisfies Record<
  RpcMethod,
  { params: TSchema; result: TSchema; project?: (v: unknown) => unknown }
>;

export function firstSchemaError(schema: TSchema, value: unknown): string {
  const [error] = Value.Errors(schema, value);
  if (!error) {
    return "/: invalid";
  }
  const path = (error as { instancePath?: string }).instancePath || "/";
  return `${path}: ${(error as { keyword?: string }).keyword ?? "invalid"}`;
}

/** Why `params` are not acceptable for `method`, or null. Never includes values. */
export function validateParams(method: RpcMethod, params: unknown): string | null {
  const over = findOverLimit(params, PARAMS_LIMITS_BY_METHOD[method] ?? PARAMS_LIMITS);
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
  const over = findOverLimit(payload, RESULT_LIMITS_BY_METHOD[method] ?? RESULT_LIMITS);
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

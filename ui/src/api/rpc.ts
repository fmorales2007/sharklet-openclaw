// Sharklet's typed RPC layer: one place where pages call the gateway, with
// shared errors and stale-while-refreshing. Contract fixed in F1-02;
// F1-06 adds the logic: schema validation both ways, backoff, refresh.
// Nothing here carries a token or key: the browser never sees one.
import { ErrorCodes } from "@openclaw/gateway-client/browser";
import { err, ok, type Result } from "@openclaw/normalization-core/result";
import type { AgentsListParams } from "../../../packages/gateway-protocol/src/schema/agents-models-skills.js";
import type { CronListParams } from "../../../packages/gateway-protocol/src/schema/cron.types.js";
import type { SessionsListParams } from "../../../packages/gateway-protocol/src/schema/sessions-list.js";
import { t } from "../i18n/index.ts";
import type { CostUsageSummary } from "../pages/usage/data-types.ts";
import type { GatewayBrowserClient } from "./gateway.ts";
import { findKeyShapedField, validateParams, validateResult } from "./rpc-schemas.ts";
import type { AgentsListResult, SessionsListResult } from "./types.ts";

export type RpcClient = Pick<GatewayBrowserClient, "request">;

/** `usage.cost` params, as `requestUsageSnapshot` already sends them. */
export type UsageCostParams = {
  startDate: string;
  endDate: string;
  agentScope?: "all";
  agentId?: string;
  mode?: "utc" | "specific";
  utcOffset?: string;
  timeZone?: string;
};

/** `pages.state` result: the page kill switch (`ui.pages.off` in the gateway config). */
export type PagesStateResult = { off: { id: string; reason?: string }[] };

/** A `cron.list` row reduced to what Up next reads (rpc-schemas.ts projects it). */
export type UpNextJob = {
  id: string;
  name: string;
  enabled: boolean;
  agentId?: string;
  state?: { nextRunAtMs?: number; runningAtMs?: number };
};

/** `sessions.create` as the composer sends it (F2-01): no message, attachments or worktree. */
export type ChatSessionsCreateParams = {
  idempotencyKey: string; // required here, optional on the wire: a retried create must not fork a chat
  agentId: string;
  model?: string;
  thinkingLevel?: string;
  memoryless?: true;
};

/** `sessions.create` result reduced to what the composer and chat read. */
export type ChatSessionsCreateResult = {
  key: string;
  sessionId?: string;
  entry?: { memoryless?: true };
};

// Methods used by the Phase 2 tracks (chat contract, F2-01). Track A = composer
// and chat; track B = You and Memory-less.
//
// - A: create a chat (agent, model, effort, Memory-less): sessions.create.
//   Reuse; `memoryless` is new; the gateway stub fails until F2-09.
// - A: first turn and the rest: chat.send. Reuse; outside rpcCall (streaming), as today.
// - A and chat: read the Memory-less mark: sessions.list, row `memoryless`. Reuse.
// - A: read Defaults: agents.list + sessions.list `defaults.model`. Reuse.
// - B: save Defaults: agents.update (model, thinkingDefault; null clears). F2-07 added
//   thinkingDefault to the method so one validated call owns both overrides.
// - B: USER.md, AGENTS.md, MEMORY.md: agents.files.get / agents.files.set (expectedHash),
//   with their own params ceiling in rpc-schemas.ts.
// - B: size limits and per-agent switches: agents.files.list (limits, personalContext);
//   a switch is saved with agents.update (personalContext). F2-08.

/** The three agent files You reads and writes; `hash` is what `expectedHash` expects back. */
export type AgentFileName = "USER.md" | "AGENTS.md" | "MEMORY.md";
export type AgentFileResult = {
  agentId: string;
  file: { name: AgentFileName; missing: boolean; size?: number; hash?: string; content?: string };
};
export type AgentFilesSetParams = {
  agentId: string;
  name: AgentFileName;
  content: string;
  expectedHash?: string;
};

/** The pieces of personal context an agent can be switched off from reading (F2-08). */
export type PersonalContextSwitches = {
  aboutYou: boolean;
  responseStyle: boolean;
  skillRules: boolean;
  memory: boolean;
};

/** What the gateway truncates an agent's files by, as `agents.files.list` reports it. */
export type AgentFilesLimits = {
  fileMaxChars: number;
  totalMaxChars: number;
  userMaxChars: number;
  memoryAdvisoryChars: number;
};

export type AgentFilesListResult = {
  agentId: string;
  limits: AgentFilesLimits;
  personalContext: PersonalContextSwitches;
};

/** `agents.update` as You sends it: model, thinking level (null clears) and context switches. */
export type AgentsUpdateOverridesParams = {
  agentId: string;
  model?: string | null;
  thinkingDefault?: string | null;
  personalContext?: Partial<PersonalContextSwitches>;
};

/** Gateway methods the typed layer knows. Later phases add rows here. */
export type RpcMethodMap = {
  "sessions.create": { params: ChatSessionsCreateParams; result: ChatSessionsCreateResult };
  "sessions.list": { params: SessionsListParams; result: SessionsListResult };
  "cron.list": { params: CronListParams; result: { jobs: UpNextJob[]; total: number } };
  "usage.cost": { params: UsageCostParams; result: CostUsageSummary };
  "agents.list": { params: AgentsListParams; result: AgentsListResult };
  "pages.state": { params: Record<string, never>; result: PagesStateResult };
  "agents.files.list": { params: { agentId: string }; result: AgentFilesListResult };
  "agents.files.get": {
    params: { agentId: string; name: AgentFileName };
    result: AgentFileResult;
  };
  "agents.files.set": { params: AgentFilesSetParams; result: AgentFileResult };
  "agents.update": {
    params: AgentsUpdateOverridesParams;
    result: { ok: true; agentId: string };
  };
};

export type RpcMethod = keyof RpcMethodMap;
export type RpcParams<M extends RpcMethod> = RpcMethodMap[M]["params"];
export type RpcResultOf<M extends RpcMethod> = RpcMethodMap[M]["result"];

// One type per generic state of docs/design-system/board.md that a call can be
// in. `state` is the board state, literally: loading → skeleton, error → error
// with Try again. Off is a page's state (lib/pages-off.ts), not a call's.

/** First load only; the widget shows "Still loading" and a cancel at `since` + 10 s. */
export type RpcLoading = { state: "loading"; since: number };

export type RpcErrorKind =
  /** No connection to the gateway. */
  | "unreachable"
  /** The call ran past its deadline. */
  | "timeout"
  /** Missing scope or rejected auth. */
  | "unauthorized"
  /** The gateway answered with an error. */
  | "rejected"
  /** Params or response failed the schema (either direction). */
  | "invalid"
  /** The user cancelled a slow load. */
  | "cancelled";

export type RpcError = {
  state: "error";
  kind: RpcErrorKind;
  method: RpcMethod;
  /** One sentence: what failed and what to do (writing.md). Never a bare code. */
  message: string;
  /** Gateway text for the collapsed `<details>`. Redacted: never tokens or keys. */
  detail?: string;
  /** Drives backoff and whether Try again is offered. */
  retryable: boolean;
  retryAfterMs?: number;
};

/** `stale` is true while a refresh runs over data already on screen. */
export type RpcReady<T> = { state: "ready"; data: T; fetchedAt: number; stale: boolean };

/** An error after data was shown keeps that data as `last`: board.md's inline error. */
export type RpcSnapshot<T> =
  | RpcLoading
  | RpcReady<T>
  | (RpcError & { last?: { data: T; fetchedAt: number } });

/** Retry knobs. Defaults: 3 retries, 500 ms base, 8 s cap. `random` and `sleep` exist for tests. */
export type RpcRetryOptions = {
  maxRetries?: number;
  baseMs?: number;
  capMs?: number;
  random?: () => number;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
};

/**
 * Delay before retry number `attempt` (0-based): exponential, capped, with
 * equal jitter (half fixed, half random) so a burst of failed widgets does not
 * retry in lockstep. The gateway's `retryAfterMs` is a floor.
 */
export function backoffDelayMs(
  attempt: number,
  {
    baseMs = 500,
    capMs = 8000,
    random = Math.random,
  }: Pick<RpcRetryOptions, "baseMs" | "capMs" | "random">,
  retryAfterMs = 0,
): number {
  const ceiling = Math.min(capMs, baseMs * 2 ** attempt);
  return Math.max(ceiling / 2 + (random() * ceiling) / 2, retryAfterMs);
}

function sleepUnlessAborted(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", done);
      resolve();
    };
    const timer = setTimeout(done, ms);
    signal?.addEventListener("abort", done, { once: true });
  });
}

const ERROR_MESSAGES = {
  unreachable: () => t("rpc.unreachable"),
  timeout: () => t("rpc.timeout"),
  unauthorized: () => t("rpc.unauthorized"),
  rejected: () => t("rpc.rejected"),
  invalid: () => t("rpc.invalid"),
  cancelled: () => t("rpc.cancelled"),
} satisfies Record<RpcErrorKind, () => string>;

function rpcError(
  method: RpcMethod,
  kind: RpcErrorKind,
  retryable: boolean,
  detail?: string,
  retryAfterMs?: number,
): RpcError {
  return {
    state: "error",
    kind,
    method,
    message: ERROR_MESSAGES[kind](),
    ...(detail ? { detail: detail.slice(0, 500) } : {}),
    retryable,
    ...(retryAfterMs === undefined ? {} : { retryAfterMs }),
  };
}

/** Gateway text for the collapsed details, unless it carries something key-shaped. */
function safeDetail(message: string): string | undefined {
  return message && findKeyShapedField(message) === null ? message : undefined;
}

// Duck-typed on `code`/`retryable`: GatewayProtocolRequestError and its
// subclasses (the UI's GatewayRequestError among them) share that shape, and
// the local deadline error carries CLIENT_TIMEOUT. A method the gateway does not
// know is an error like any other: UI and gateway ship together (ui/AGENTS.md).
function classifyFailure(error: unknown, method: RpcMethod, signal?: AbortSignal): RpcError {
  if (signal?.aborted) {
    return rpcError(method, "cancelled", false);
  }
  const { code, message, retryable, retryAfterMs } = (error ?? {}) as {
    code?: unknown;
    message?: unknown;
    retryable?: unknown;
    retryAfterMs?: unknown;
  };
  const text = typeof message === "string" ? message : "";
  if (code === "CLIENT_TIMEOUT") {
    return rpcError(method, "timeout", true, safeDetail(text));
  }
  if (typeof code !== "string") {
    // A plain Error from the client: socket not connected, closed, stopped.
    return rpcError(method, "unreachable", true, safeDetail(text));
  }
  if (code === ErrorCodes.FORBIDDEN || code === ErrorCodes.NOT_PAIRED) {
    return rpcError(method, "unauthorized", false, safeDetail(text));
  }
  return rpcError(
    method,
    "rejected",
    retryable === true,
    safeDetail(text),
    typeof retryAfterMs === "number" ? retryAfterMs : undefined,
  );
}

/** No call waits longer than this; the gateway client rejects it with CLIENT_TIMEOUT. */
const REQUEST_TIMEOUT_MS = 15_000;

/** One validated call, retried with backoff while the error is transient. */
export async function rpcCall<M extends RpcMethod>(
  client: RpcClient,
  method: M,
  params: RpcParams<M>,
  options: { signal?: AbortSignal; retry?: RpcRetryOptions } = {},
): Promise<Result<RpcResultOf<M>, RpcError>> {
  const { signal, retry = {} } = options;
  const badParams = validateParams(method, params);
  if (badParams) {
    return err(rpcError(method, "invalid", false, badParams));
  }
  const { maxRetries = 3, sleep = sleepUnlessAborted } = retry;
  for (let attempt = 0; ; attempt++) {
    if (signal?.aborted) {
      return err(rpcError(method, "cancelled", false));
    }
    let failure: RpcError;
    try {
      const payload = await client.request(method, params, {
        timeoutMs: REQUEST_TIMEOUT_MS,
        ...(signal ? { signal } : {}),
      });
      const checked = validateResult(method, payload);
      return checked.ok
        ? ok(checked.value)
        : err(rpcError(method, "invalid", false, checked.detail));
    } catch (error) {
      failure = classifyFailure(error, method, signal);
    }
    if (!failure.retryable || attempt >= maxRetries) {
      return err(failure);
    }
    await sleep(backoffDelayMs(attempt, retry, failure.retryAfterMs), signal);
  }
}

/**
 * A live value under stale-while-refreshing: a refresh keeps the data
 * (`stale: true`), and a failed refresh keeps it as `last`.
 */
export type RpcResource<T> = {
  readonly snapshot: RpcSnapshot<T>;
  subscribe(listener: (snapshot: RpcSnapshot<T>) => void): () => void;
  /**
   * Widget-scoped Try again marks what is on screen as stale while it runs; a
   * `quiet` background refresh replaces it only when the new value arrives.
   */
  refresh(options?: { quiet?: boolean }): void;
  /** The cancel under "Still loading"; ends in `error` with kind `cancelled`. */
  cancel(): void;
  dispose(): void;
};

export function rpcResource<M extends RpcMethod, T>(
  client: RpcClient,
  method: M,
  /** A function is called on every run, for params that move with the clock. */
  params: RpcParams<M> | (() => RpcParams<M>),
  select: (result: RpcResultOf<M>) => T,
  options: { retry?: RpcRetryOptions; now?: () => number } = {},
): RpcResource<T> {
  const now = options.now ?? Date.now;
  const listeners = new Set<(snapshot: RpcSnapshot<T>) => void>();
  let snapshot: RpcSnapshot<T> = { state: "loading", since: now() };
  let last: { data: T; fetchedAt: number } | undefined;
  let controller: AbortController | undefined;
  // A result only publishes while its generation is current: cancel, dispose
  // and a newer run all retire the one in flight (ui/AGENTS.md).
  let generation = 0;
  let disposed = false;

  const publish = (next: RpcSnapshot<T>) => {
    snapshot = next;
    for (const listener of Array.from(listeners)) {
      listener(next);
    }
  };

  const run = () => {
    const mine = ++generation;
    const own = new AbortController();
    controller = own;
    const current = typeof params === "function" ? params() : params;
    void rpcCall(client, method, current, { signal: own.signal, retry: options.retry }).then(
      (result) => {
        if (mine !== generation) {
          return;
        }
        controller = undefined;
        if (!result.ok) {
          const failure = result.error;
          publish(last ? { ...failure, last } : failure);
          return;
        }
        try {
          last = { data: select(result.value), fetchedAt: now() };
        } catch {
          const invalid = rpcError(method, "invalid", false, "/: select failed");
          publish(last ? { ...invalid, last } : invalid);
          return;
        }
        publish({ state: "ready", ...last, stale: false });
      },
    );
  };

  run();

  return {
    get snapshot() {
      return snapshot;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    refresh({ quiet = false } = {}) {
      if (disposed || controller) {
        return;
      }
      // Keep what is known on screen, marked old, instead of a skeleton.
      if (!quiet) {
        publish(
          last ? { state: "ready", ...last, stale: true } : { state: "loading", since: now() },
        );
      }
      run();
    },
    cancel() {
      if (!controller) {
        return;
      }
      generation++;
      controller.abort();
      controller = undefined;
      const cancelled = rpcError(method, "cancelled", false);
      publish(last ? { ...cancelled, last } : cancelled);
    },
    dispose() {
      disposed = true;
      generation++;
      controller?.abort();
      controller = undefined;
      listeners.clear();
    },
  };
}

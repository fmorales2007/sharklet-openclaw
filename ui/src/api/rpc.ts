// Sharklet's typed RPC layer: one place where pages call the gateway, with
// shared errors and stale-while-refreshing. Contract fixed in F1-02; the
// logic (schema validation both ways, backoff, refresh) lands in F1-06.
// Nothing here carries a token or key: the browser never sees one.
import type { Result } from "@openclaw/normalization-core/result";
import type { AgentsListParams } from "../../../packages/gateway-protocol/src/schema/agents-models-skills.js";
import type { CronListParams } from "../../../packages/gateway-protocol/src/schema/cron.types.js";
import type { SessionsListParams } from "../../../packages/gateway-protocol/src/schema/sessions-list.js";
import type { CostUsageSummary } from "../pages/usage/data-types.ts";
import type { GatewayBrowserClient } from "./gateway.ts";
import type { AgentsListResult, CronJobsListResult, SessionsListResult } from "./types.ts";

export type RpcClient = Pick<GatewayBrowserClient, "request">;

/** `usage.cost` params, as `requestUsageSnapshot` already sends them. */
export type UsageCostParams = {
  startDate: string;
  endDate: string;
  agentScope?: "all";
  agentId?: string;
  mode?: "utc" | "specific";
  utcOffset?: string;
};

/** Gateway methods the typed layer knows. Later phases add rows here. */
export type RpcMethodMap = {
  "sessions.list": { params: SessionsListParams; result: SessionsListResult };
  "cron.list": { params: CronListParams; result: CronJobsListResult };
  "usage.cost": { params: UsageCostParams; result: CostUsageSummary };
  "agents.list": { params: AgentsListParams; result: AgentsListResult };
};

export type RpcMethod = keyof RpcMethodMap;
export type RpcParams<M extends RpcMethod> = RpcMethodMap[M]["params"];
export type RpcResultOf<M extends RpcMethod> = RpcMethodMap[M]["result"];

// One type per generic state in docs/design-system/board.md. `state` is the
// board state, literally: loading → skeleton, error → error with Try again,
// off → `.board-widget__disabled-plugin`.

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

export type RpcOff = {
  state: "off";
  /** `disabled`: a page kill switch (F1-07). `unavailable`: the gateway lacks the method. */
  reason: "disabled" | "unavailable";
  method: RpcMethod;
  /** Why it is off and when it comes back. */
  message: string;
};

/** `stale` is true while a refresh runs over data already on screen. */
export type RpcReady<T> = { state: "ready"; data: T; fetchedAt: number; stale: boolean };

/** An error after data was shown keeps that data as `last`: board.md's inline error. */
export type RpcSnapshot<T> =
  | RpcLoading
  | RpcReady<T>
  | (RpcError & { last?: { data: T; fetchedAt: number } })
  | RpcOff;

export type RpcFailure = RpcError | RpcOff;

/** Retry knobs. Defaults: 3 retries, 500 ms base, 8 s cap. `random` and `sleep` exist for tests. */
export type RpcRetryOptions = {
  maxRetries?: number;
  baseMs?: number;
  capMs?: number;
  random?: () => number;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
};

/** Delay before retry number `attempt` (0-based): exponential, capped, equal jitter, floored by `retryAfterMs`. */
export function backoffDelayMs(
  _attempt: number,
  _options: Pick<RpcRetryOptions, "baseMs" | "capMs" | "random">,
  _retryAfterMs?: number,
): number {
  throw new Error("not implemented: backoffDelayMs (F1-06)");
}

/** One validated call, retried with backoff while the error is transient. */
export function rpcCall<M extends RpcMethod>(
  _client: RpcClient,
  _method: M,
  _params: RpcParams<M>,
  _options?: { signal?: AbortSignal; retry?: RpcRetryOptions },
): Promise<Result<RpcResultOf<M>, RpcFailure>> {
  throw new Error("not implemented: rpcCall (F1-06)");
}

/**
 * A live value under stale-while-refreshing: a refresh keeps the data
 * (`stale: true`), and a failed refresh keeps it as `last`.
 */
export type RpcResource<T> = {
  readonly snapshot: RpcSnapshot<T>;
  subscribe(listener: (snapshot: RpcSnapshot<T>) => void): () => void;
  /** Widget-scoped Try again, or a background refresh. */
  refresh(): void;
  /** The cancel under "Still loading"; ends in `error` with kind `cancelled`. */
  cancel(): void;
  dispose(): void;
};

export function rpcResource<M extends RpcMethod, T>(
  _client: RpcClient,
  _method: M,
  _params: RpcParams<M>,
  _select: (result: RpcResultOf<M>) => T,
  _options?: { retry?: RpcRetryOptions; now?: () => number },
): RpcResource<T> {
  throw new Error("not implemented: rpcResource (F1-06)");
}

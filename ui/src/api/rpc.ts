// Sharklet's typed RPC layer: one place where pages call the gateway, with
// shared errors and stale-while-refreshing. Contract fixed in F1-02;
// F1-06 adds the logic: schema validation both ways, backoff, refresh.
// Nothing here carries a token or key: the browser never sees one.
import { err, ok, type Result } from "@openclaw/normalization-core/result";
import type { AgentsListParams } from "../../../packages/gateway-protocol/src/schema/agents-models-skills.js";
import type { CronListParams } from "../../../packages/gateway-protocol/src/schema/cron.types.js";
import type { SessionsListParams } from "../../../packages/gateway-protocol/src/schema/sessions-list.js";
import { t } from "../i18n/index.ts";
import type { CostUsageSummary } from "../pages/usage/data-types.ts";
import type { GatewayBrowserClient } from "./gateway.ts";
import { findKeyShapedField, validateParams, validateResult } from "./rpc-schemas.ts";
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
  timeZone?: string;
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
// the local deadline error carries CLIENT_TIMEOUT.
function classifyFailure(error: unknown, method: RpcMethod, signal?: AbortSignal): RpcFailure {
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
  if (code === "INVALID_REQUEST" && text.startsWith("unknown method")) {
    return { state: "off", reason: "unavailable", method, message: t("rpc.offUnavailable") };
  }
  if (code === "FORBIDDEN" || code === "NOT_PAIRED") {
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

/** One validated call, retried with backoff while the error is transient. */
export async function rpcCall<M extends RpcMethod>(
  client: RpcClient,
  method: M,
  params: RpcParams<M>,
  options: { signal?: AbortSignal; retry?: RpcRetryOptions } = {},
): Promise<Result<RpcResultOf<M>, RpcFailure>> {
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
    let failure: RpcFailure;
    try {
      const payload = await client.request(method, params, signal ? { signal } : undefined);
      const checked = validateResult(method, payload);
      return checked.ok
        ? ok(checked.value)
        : err(rpcError(method, "invalid", false, checked.detail));
    } catch (error) {
      failure = classifyFailure(error, method, signal);
    }
    if (failure.state === "off" || !failure.retryable || attempt >= maxRetries) {
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
  /** Widget-scoped Try again, or a background refresh. */
  refresh(): void;
  /** The cancel under "Still loading"; ends in `error` with kind `cancelled`. */
  cancel(): void;
  dispose(): void;
};

export function rpcResource<M extends RpcMethod, T>(
  client: RpcClient,
  method: M,
  params: RpcParams<M>,
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
    for (const listener of [...listeners]) {
      listener(next);
    }
  };

  const run = () => {
    const mine = ++generation;
    const own = new AbortController();
    controller = own;
    void rpcCall(client, method, params, { signal: own.signal, retry: options.retry }).then(
      (result) => {
        if (mine !== generation) {
          return;
        }
        controller = undefined;
        if (!result.ok) {
          const failure = result.error;
          publish(failure.state === "error" && last ? { ...failure, last } : failure);
          return;
        }
        try {
          last = { data: select(result.value), fetchedAt: now() };
        } catch {
          publish(rpcError(method, "invalid", false, "/: select failed"));
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
    refresh() {
      if (disposed || controller) {
        return;
      }
      // Keep what is known on screen, marked old, instead of a skeleton.
      publish(last ? { state: "ready", ...last, stale: true } : { state: "loading", since: now() });
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

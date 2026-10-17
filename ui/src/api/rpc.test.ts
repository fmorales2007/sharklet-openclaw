import { describe, expect, expectTypeOf, it, vi } from "vitest";
import {
  GatewayProtocolRequestError,
  GatewayProtocolRequestTimeoutError,
} from "../../../packages/gateway-client/src/protocol-request.ts";
import { chatYouScenario } from "../e2e/chat-you-fixtures.test-support.ts";
import { createMissionControlMethodResponses } from "../e2e/mission-control-fixtures.test-support.ts";
import { findKeyShapedField } from "./rpc-schemas.ts";
import {
  backoffDelayMs,
  rpcCall,
  rpcResource,
  type RpcClient,
  type RpcMethod,
  type RpcMethodMap,
  type RpcSnapshot,
} from "./rpc.ts";

const fixtures = createMissionControlMethodResponses();
const usageParams = { startDate: "2026-10-01", endDate: "2026-10-15" };

type Handler = (method: string, params: unknown) => Promise<unknown>;
function clientOf(handler: Handler) {
  const request = vi.fn(handler);
  return { client: { request } as unknown as RpcClient, request };
}
const respondWith = (method: string) => clientOf(async (m) => (m === method ? fixtures[m] : null));

const sleeps: number[] = [];
const retry = {
  maxRetries: 3,
  random: () => 1,
  sleep: async (ms: number) => {
    sleeps.push(ms);
  },
};
const unavailable = () =>
  new GatewayProtocolRequestError({ code: "UNAVAILABLE", message: "busy", retryable: true });

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

describe("rpcCall validation", () => {
  it.each([
    ["an unexpected field", "sessions.list", { activeOnly: true, extra: 1 }],
    ["a wrong type", "sessions.list", { activeOnly: "yes" }],
    ["a string over the maximum length", "cron.list", { query: "x".repeat(5000) }],
    ["a malformed date", "usage.cost", { startDate: "yesterday", endDate: "2026-10-01" }],
    ["an oversized agent id", "usage.cost", { ...usageParams, agentId: "a".repeat(5000) }],
  ] as const)("rejects params with %s before sending", async (_name, method, params) => {
    const { client, request } = respondWith(method);
    const result = await rpcCall(client, method, params as never, { retry });
    expect(result).toMatchObject({
      ok: false,
      error: { state: "error", kind: "invalid", retryable: false },
    });
    expect(request).not.toHaveBeenCalled();
  });

  it.each(["sessions.list", "cron.list", "usage.cost", "agents.list"] as const)(
    "accepts the %s fixture response",
    async (method) => {
      const params = method === "usage.cost" ? usageParams : {};
      const { client } = respondWith(method);
      expect((await rpcCall(client, method, params, { retry })).ok).toBe(true);
    },
  );

  it.each([
    ["an unexpected field", "agents.list", (r: any) => ({ ...r, extra: true })],
    ["a wrong type", "cron.list", (r: any) => ({ ...r, total: "3" })],
    [
      "a string over the maximum length",
      "sessions.list",
      (r: any) => ({ ...r, sessions: [{ ...r.sessions[0], label: "x".repeat(100_000) }] }),
    ],
    [
      "an array over the maximum length",
      "usage.cost",
      (r: any) => ({ ...r, daily: Array.from({ length: 5000 }, () => ({})) }),
    ],
  ] as const)("rejects a response with %s and does not retry", async (_name, method, mutate) => {
    const bad = mutate(fixtures[method] as never);
    const { client, request } = clientOf(async () => bad);
    const params = method === "usage.cost" ? usageParams : {};
    const result = await rpcCall(client, method, params, { retry });
    expect(result).toMatchObject({
      ok: false,
      error: { kind: "invalid", retryable: false, method },
    });
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("projects session rows to the declared fields instead of failing on new ones", async () => {
    const base = fixtures["sessions.list"] as { sessions: Record<string, unknown>[] };
    const wide = { ...base, sessions: [{ ...base.sessions[0], futureGatewayField: 1 }] };
    const { client } = clientOf(async () => wide);
    const result = await rpcCall(client, "sessions.list", { activeOnly: true }, { retry });
    expect(result.ok && result.value.sessions[0]).not.toHaveProperty("futureGatewayField");
    expect(result.ok && result.value.sessions[0]).toHaveProperty("key");
  });

  it("keeps only what Up next reads from the gateway's wider cron.list rows", async () => {
    const { client } = respondWith("cron.list");
    const result = await rpcCall(client, "cron.list", {}, { retry });
    expect(result.ok && result.value.jobs[0]).toEqual({
      id: "synthetic-inbox",
      name: "Inbox digest",
      enabled: true,
      state: { nextRunAtMs: expect.any(Number) },
    });
  });
});

describe("no keys in the client", () => {
  const secret = "sk-or-v1-0123456789abcdef0123456789abcdef";

  it.each([
    ["a secret-named field", { a: { apiKey: "x" } }, "/a/apiKey"],
    ["a token-named field", { rows: [{ accessToken: "x" }] }, "/rows/0/accessToken"],
    ["an OpenRouter-shaped value", { label: secret }, "/label"],
    ["a GitHub token value", { v: "ghp_abcdefghijklmnopqrstuvwxyz0123456789" }, "/v"],
    ["a JWT value", { v: "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.c2ln" }, "/v"],
    ["a PEM header", { v: "-----BEGIN PRIVATE KEY-----" }, "/v"],
  ])("finds %s", (_name, value, path) => {
    expect(findKeyShapedField(value)).toBe(path);
  });

  it("leaves usage totals, session keys and ordinary text alone", () => {
    expect(
      findKeyShapedField({
        totalTokens: 5,
        key: "agent:main:x",
        sessionKey: "agent:main:y",
        label: "Draft notes",
      }),
    ).toBeNull();
  });

  it("rejects a response that carries a key and never echoes the value", async () => {
    const base = fixtures["sessions.list"] as { sessions: Record<string, unknown>[] };
    const leaky = { ...base, sessions: [{ ...base.sessions[0], apiKey: secret }] };
    const { client } = clientOf(async () => leaky);
    const result = await rpcCall(client, "sessions.list", { activeOnly: true }, { retry });
    expect(result.ok).toBe(false);
    expect(JSON.stringify(result)).not.toContain(secret);
    expect(!result.ok && result.error).toMatchObject({
      kind: "invalid",
      detail: expect.stringContaining("/sessions/0/apiKey"),
    });
  });

  it("no contract type has a secret-named property", () => {
    type Secret =
      | "apiKey"
      | "api_key"
      | "secret"
      | "clientSecret"
      | "password"
      | "token"
      | "accessToken"
      | "refreshToken"
      | "authToken"
      | "privateKey"
      | "authorization"
      | "bearer";
    type Walk<T, D extends unknown[] = []> = D["length"] extends 5
      ? never
      : T extends readonly (infer U)[]
        ? Walk<U, [...D, 0]>
        : T extends object
          ? {
              [K in keyof T]-?: (K extends Secret ? K : never) | Walk<NonNullable<T[K]>, [...D, 0]>;
            }[keyof T]
          : never;
    type Contract = RpcMethodMap[RpcMethod];
    expectTypeOf<Walk<Contract["params"]>>().toEqualTypeOf<never>();
    expectTypeOf<Walk<Contract["result"]>>().toEqualTypeOf<never>();
  });
});

describe("backoff", () => {
  it("doubles from 500 ms up to an 8 s cap, with equal jitter", () => {
    const full = [0, 1, 2, 3, 4, 5, 10].map((n) => backoffDelayMs(n, { random: () => 1 }));
    expect(full).toEqual([500, 1000, 2000, 4000, 8000, 8000, 8000]);
    const low = [0, 3, 10].map((n) => backoffDelayMs(n, { random: () => 0 }));
    expect(low).toEqual([250, 2000, 4000]);
  });

  it("treats the gateway's retryAfterMs as a floor", () => {
    expect(backoffDelayMs(0, { random: () => 0 }, 3000)).toBe(3000);
    expect(backoffDelayMs(4, { random: () => 1 }, 1000)).toBe(8000);
  });

  it("retries a transient gateway error and ends with data", async () => {
    sleeps.length = 0;
    let calls = 0;
    const { client, request } = clientOf(async () => {
      if (++calls < 3) {
        throw unavailable();
      }
      return fixtures["agents.list"];
    });
    const result = await rpcCall(client, "agents.list", {}, { retry });
    expect(result.ok).toBe(true);
    expect(request).toHaveBeenCalledTimes(3);
    expect(sleeps).toEqual([500, 1000]);
  });

  it("gives up after maxRetries and reports a retryable error", async () => {
    const { client, request } = clientOf(async () => {
      throw unavailable();
    });
    const result = await rpcCall(client, "agents.list", {}, { retry });
    expect(request).toHaveBeenCalledTimes(4);
    expect(!result.ok && result.error).toMatchObject({
      state: "error",
      kind: "rejected",
      retryable: true,
    });
  });

  it.each([
    ["a closed socket", () => new Error("gateway not connected"), "unreachable"],
    [
      "a request timeout",
      () =>
        new GatewayProtocolRequestTimeoutError({
          method: "agents.list",
          timeoutMs: 1,
          requestSent: true,
        }),
      "timeout",
    ],
  ] as const)("retries %s", async (_name, make, kind) => {
    const { client, request } = clientOf(async () => {
      throw make();
    });
    const result = await rpcCall(client, "agents.list", {}, { retry });
    expect(request).toHaveBeenCalledTimes(4);
    expect(!result.ok && result.error).toMatchObject({ kind, retryable: true });
  });

  it.each([
    ["a rejected request", { code: "INVALID_REQUEST", message: "bad" }, "rejected"],
    ["a missing permission", { code: "FORBIDDEN", message: "missing scope" }, "unauthorized"],
  ] as const)("does not retry %s", async (_name, shape, kind) => {
    const { client, request } = clientOf(async () => {
      throw new GatewayProtocolRequestError(shape);
    });
    const result = await rpcCall(client, "agents.list", {}, { retry });
    expect(request).toHaveBeenCalledTimes(1);
    expect(!result.ok && result.error).toMatchObject({ kind, retryable: false });
  });

  it("shows a method the gateway does not know as an error, not as off", async () => {
    const { client, request } = clientOf(async () => {
      throw new GatewayProtocolRequestError({
        code: "INVALID_REQUEST",
        message: "unknown method: usage.cost",
      });
    });
    const result = await rpcCall(client, "usage.cost", usageParams, { retry });
    expect(request).toHaveBeenCalledTimes(1);
    expect(!result.ok && result.error).toMatchObject({
      state: "error",
      kind: "rejected",
      method: "usage.cost",
    });
  });

  it("gives every call a deadline", async () => {
    const { client, request } = respondWith("agents.list");
    await rpcCall(client, "agents.list", {}, { retry });
    expect(request).toHaveBeenCalledWith(
      "agents.list",
      {},
      expect.objectContaining({ timeoutMs: expect.any(Number) }),
    );
  });

  it("stops waiting when the caller aborts during backoff", async () => {
    vi.useFakeTimers();
    try {
      const controller = new AbortController();
      const { client, request } = clientOf(async () => {
        throw unavailable();
      });
      const pending = rpcCall(client, "agents.list", {}, { signal: controller.signal });
      await vi.advanceTimersByTimeAsync(0);
      controller.abort();
      const result = await pending;
      expect(request).toHaveBeenCalledTimes(1);
      expect(!result.ok && result.error).toMatchObject({ kind: "cancelled", retryable: false });
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("rpcResource stale-while-refreshing", () => {
  const opts = { retry, now: () => 1000 };
  const agentsOf = (n: string) => ({
    ...(fixtures["agents.list"] as object),
    defaultId: n,
    mainKey: n,
  });
  const select = (r: { defaultId: string }) => r.defaultId;

  it("goes loading → ready, then keeps the data (stale) during a refresh", async () => {
    const calls = [deferred<unknown>(), deferred<unknown>()];
    let i = 0;
    const { client } = clientOf(() => calls[i++]!.promise);
    const resource = rpcResource(client, "agents.list", {}, select, opts);
    const seen: RpcSnapshot<string>[] = [];
    resource.subscribe((s) => seen.push(s));
    expect(resource.snapshot).toEqual({ state: "loading", since: 1000 });

    calls[0]!.resolve(agentsOf("a"));
    await vi.waitFor(() => expect(resource.snapshot.state).toBe("ready"));
    expect(resource.snapshot).toEqual({ state: "ready", data: "a", fetchedAt: 1000, stale: false });

    resource.refresh();
    expect(resource.snapshot).toEqual({ state: "ready", data: "a", fetchedAt: 1000, stale: true });
    calls[1]!.resolve(agentsOf("b"));
    await vi.waitFor(() => expect(resource.snapshot).toMatchObject({ data: "b", stale: false }));
    expect(seen.map((s) => s.state)).toEqual(["ready", "ready", "ready"]);
  });

  it("keeps the last values and marks the error when a refresh fails", async () => {
    let fail = false;
    const { client } = clientOf(async () => {
      if (fail) {
        throw new GatewayProtocolRequestError({ code: "INVALID_REQUEST", message: "nope" });
      }
      return agentsOf("a");
    });
    const resource = rpcResource(client, "agents.list", {}, select, opts);
    await vi.waitFor(() => expect(resource.snapshot.state).toBe("ready"));
    fail = true;
    resource.refresh();
    await vi.waitFor(() => expect(resource.snapshot.state).toBe("error"));
    expect(resource.snapshot).toMatchObject({
      state: "error",
      kind: "rejected",
      last: { data: "a", fetchedAt: 1000 },
    });
  });

  it("has no last value when the first load fails", async () => {
    const { client } = clientOf(async () => {
      throw new GatewayProtocolRequestError({ code: "INVALID_REQUEST", message: "nope" });
    });
    const resource = rpcResource(client, "agents.list", {}, select, opts);
    await vi.waitFor(() => expect(resource.snapshot.state).toBe("error"));
    expect(resource.snapshot).not.toHaveProperty("last");
  });

  it("retries transient failures inside a load without showing an error", async () => {
    let calls = 0;
    const { client } = clientOf(async () => {
      if (++calls === 1) {
        throw unavailable();
      }
      return agentsOf("a");
    });
    const resource = rpcResource(client, "agents.list", {}, select, opts);
    const states: string[] = [];
    resource.subscribe((s) => states.push(s.state));
    await vi.waitFor(() => expect(resource.snapshot.state).toBe("ready"));
    expect(states).toEqual(["ready"]);
  });

  it("ignores refresh() while a call is in flight", () => {
    const { client, request } = clientOf(() => deferred<unknown>().promise);
    const resource = rpcResource(client, "agents.list", {}, select, opts);
    resource.refresh();
    resource.refresh();
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("cancel() ends in a cancelled error and a late response cannot overwrite it", async () => {
    const call = deferred<unknown>();
    const { client } = clientOf(() => call.promise);
    const resource = rpcResource(client, "agents.list", {}, select, opts);
    resource.cancel();
    expect(resource.snapshot).toMatchObject({ state: "error", kind: "cancelled" });
    call.resolve(agentsOf("late"));
    await new Promise((r) => {
      setTimeout(r, 0);
    });
    expect(resource.snapshot).toMatchObject({ state: "error", kind: "cancelled" });
  });

  it("dispose() stops notifying subscribers", async () => {
    const call = deferred<unknown>();
    const { client } = clientOf(() => call.promise);
    const resource = rpcResource(client, "agents.list", {}, select, opts);
    const listener = vi.fn();
    resource.subscribe(listener);
    resource.dispose();
    call.resolve(agentsOf("a"));
    await new Promise((r) => {
      setTimeout(r, 0);
    });
    expect(listener).not.toHaveBeenCalled();
  });
});

describe("sessions.create contract (F2-01)", () => {
  const base = { idempotencyKey: "key-1", agentId: "main" };

  it("takes a bare create and rejects a message or a false flag", async () => {
    const { client } = clientOf(async () => chatYouScenario("memoryless")["sessions.create"]);
    const ok = await rpcCall(client, "sessions.create", { ...base, memoryless: true });
    expect(ok).toEqual({
      ok: true,
      value: {
        key: "agent:main:dashboard:fixture-memoryless",
        sessionId: "fixture-session-memoryless",
        entry: { memoryless: true },
      },
    });
    for (const bad of [{ message: "x" }, { memoryless: false }]) {
      const result = await rpcCall(client, "sessions.create", { ...base, ...bad } as never);
      expect(result.ok).toBe(false);
    }
  });
});

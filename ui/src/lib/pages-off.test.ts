import { beforeAll, describe, expect, it, vi } from "vitest";
import type { ApplicationGateway } from "../app/gateway.ts";
import { PagesOffStore } from "./pages-off.ts";

function fakeGateway(request: (method: string) => Promise<unknown>) {
  let snapshotListener: (() => void) | undefined;
  let eventListener: ((event: { event: string }) => void) | undefined;
  const gateway = {
    snapshot: { phase: "connected", client: { request } },
    subscribe: (listener: () => void) => {
      snapshotListener = listener;
      return () => undefined;
    },
    subscribeEvents: (listener: (event: { event: string }) => void) => {
      eventListener = listener;
      return () => undefined;
    },
  } as unknown as ApplicationGateway;
  return { gateway, emit: (event: string) => eventListener?.({ event }), snapshotListener };
}

describe("PagesOffStore", () => {
  // The store imports the RPC layer lazily; warm it so a cold import (slow CI, first test of a shard)
  // doesn't eat the waitFor budget.
  beforeAll(() => import("../api/rpc.ts"));

  it("reads pages.state, refreshes on config.changed and never turns off the way back", async () => {
    let off = [{ id: "usage", reason: "Repairs." }, { id: "chat" }];
    const request = vi.fn(async () => ({ off }));
    const store = new PagesOffStore();
    const notify = vi.fn();
    const { gateway, emit } = fakeGateway(request);
    store.connect(gateway, notify);
    await vi.waitFor(() => expect(notify).toHaveBeenCalledTimes(1));
    expect(store.get("usage")).toEqual({ reason: "Repairs." });
    expect(store.get("chat")).toBeUndefined();

    off = [];
    emit("config.changed");
    await vi.waitFor(() => expect(store.get("usage")).toBeUndefined());
  });

  it("keeps the last known state when a refresh fails", async () => {
    let fail = false;
    const request = vi.fn(async () => {
      if (fail) {
        throw Object.assign(new Error("rejected"), { code: "UNAVAILABLE", retryable: false });
      }
      return { off: [{ id: "usage" }] };
    });
    const store = new PagesOffStore();
    const { gateway, emit } = fakeGateway(request);
    store.connect(gateway, () => undefined);
    await vi.waitFor(() => expect(store.get("usage")).toBeDefined());
    fail = true;
    emit("config.changed");
    await new Promise((resolve) => {
      setTimeout(resolve, 20);
    });
    expect(store.get("usage")).toBeDefined();
  });
});

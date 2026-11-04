import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_EXEC_APPROVAL_TIMEOUT_MS } from "../infra/exec-approvals-core.js";
import { createTestApprovalManager } from "./exec-approval-manager.test-support.js";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("exec approval default timeout", () => {
  it("is 30 minutes", () => {
    expect(DEFAULT_EXEC_APPROVAL_TIMEOUT_MS).toBe(30 * 60_000);
  });

  it("denies an unanswered approval on its own at 30 minutes, with no client connected", async (testContext) => {
    const onExpired = vi.fn();
    // The manager lives in the gateway process: no client, tab or socket is involved.
    const manager = createTestApprovalManager(testContext, { onExpired });
    const record = manager.create(
      { command: "printf unattended" },
      DEFAULT_EXEC_APPROVAL_TIMEOUT_MS,
    );
    const decision = manager.register(record, DEFAULT_EXEC_APPROVAL_TIMEOUT_MS);

    await vi.advanceTimersByTimeAsync(DEFAULT_EXEC_APPROVAL_TIMEOUT_MS - 1);
    expect(onExpired).not.toHaveBeenCalled();
    expect(manager.getSnapshot(record.id)?.resolvedAtMs).toBeUndefined();

    await vi.advanceTimersByTimeAsync(1);
    await expect(decision).resolves.toBeNull();
    expect(onExpired).toHaveBeenCalledTimes(1);
    expect(manager.getSnapshot(record.id)).toMatchObject({
      status: "expired",
      terminalReason: "timeout",
    });
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";
import { notifyApprovalArrival } from "./approval-notification.ts";
import type { ExecApprovalRequest } from "./exec-approval.ts";

const approval = {
  id: "a1",
  kind: "exec",
  createdAtMs: 1,
  expiresAtMs: 2,
  request: { command: "rm -rf build", sessionKey: "agent:main:main" },
} as unknown as ExecApprovalRequest;

function stubNotification(permission: NotificationPermission) {
  const ctor = vi.fn(function () {
    return { addEventListener: vi.fn() };
  });
  const requestPermission = vi.fn();
  vi.stubGlobal("Notification", Object.assign(ctor, { permission, requestPermission }));
  return { ctor, requestPermission };
}

function stubTab(visibility: DocumentVisibilityState, focused: boolean) {
  vi.spyOn(document, "visibilityState", "get").mockReturnValue(visibility);
  vi.spyOn(document, "hasFocus").mockReturnValue(focused);
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("notifyApprovalArrival", () => {
  it("sends a system notification when permission is granted and the tab is in the background", () => {
    const { ctor } = stubNotification("granted");
    stubTab("hidden", false);
    notifyApprovalArrival(approval);
    expect(ctor).toHaveBeenCalledWith("Needs you", { body: "rm -rf build", tag: "approval:a1" });
  });

  it("stays quiet while the owner is looking at the tab", () => {
    const { ctor } = stubNotification("granted");
    stubTab("visible", true);
    notifyApprovalArrival(approval);
    expect(ctor).not.toHaveBeenCalled();
  });

  it("never asks for permission and sends nothing without it", () => {
    const { ctor, requestPermission } = stubNotification("default");
    stubTab("hidden", false);
    notifyApprovalArrival(approval);
    expect(ctor).not.toHaveBeenCalled();
    expect(requestPermission).not.toHaveBeenCalled();
  });
});

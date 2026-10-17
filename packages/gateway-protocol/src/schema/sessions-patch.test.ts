import { describe, expect, it } from "vitest";
import { validateSessionsPatchParams } from "../index.js";

describe("session patch schema", () => {
  it("validates session settings compare-and-set fields", () => {
    expect(
      validateSessionsPatchParams({
        key: "agent:main:settings-cas",
        expectedPermissionMode: "guarded",
        permissionMode: "workspace",
        expectedToolOverrides: { webSearch: false },
        toolOverrides: { skills: { release: false } },
      }),
    ).toBe(true);
    expect(
      validateSessionsPatchParams({
        key: "agent:main:settings-cas",
        expectedToolOverrides: { unknown: true },
        toolOverrides: null,
      }),
    ).toBe(false);
  });

  it("validates lifecycle and unread acknowledgement identities", () => {
    expect(
      validateSessionsPatchParams({
        key: "agent:main:self-archive",
        archived: true,
        expectedSessionId: "session-self-archive",
        expectedLifecycleRevision: "revision-self-archive",
      }),
    ).toBe(true);
    expect(
      validateSessionsPatchParams({
        key: "agent:main:mark-read",
        unread: false,
        expectedMarkedUnreadAt: 42,
      }),
    ).toBe(true);
    expect(
      validateSessionsPatchParams({ key: "agent:main:self-archive", expectedSessionId: "" }),
    ).toBe(false);
    expect(
      validateSessionsPatchParams({
        key: "agent:main:self-archive",
        expectedLifecycleRevision: "",
      }),
    ).toBe(false);
    expect(
      validateSessionsPatchParams({
        key: "agent:main:mark-read",
        unread: false,
        expectedMarkedUnreadAt: -1,
      }),
    ).toBe(false);
  });
});

describe("session patch memoryless", () => {
  it("has no memoryless field: the mark is fixed at creation", () => {
    expect(validateSessionsPatchParams({ key: "k", memoryless: false })).toBe(false);
    expect(validateSessionsPatchParams({ key: "k", memoryless: true })).toBe(false);
  });
});

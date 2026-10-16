import { describe, expect, it } from "vitest";
import {
  CHAT_YOU_SESSIONS_LIST,
  chatYouScenario,
} from "../../e2e/chat-you-fixtures.test-support.ts";
import { createChat } from "./chat-create.ts";
import { isMemorylessSession, memorylessCreateParams } from "./memoryless.ts";

describe("Memory-less mark", () => {
  it("reads the mark from session rows", () => {
    const [normal, memoryless] = CHAT_YOU_SESSIONS_LIST.sessions;
    expect(isMemorylessSession(normal)).toBe(false);
    expect(isMemorylessSession(memoryless)).toBe(true);
    expect(isMemorylessSession(null)).toBe(false);
  });

  it("asks for the flag only as a creation param", () => {
    expect(memorylessCreateParams(true)).toEqual({ memoryless: true });
    expect(memorylessCreateParams(false)).toEqual({});
  });

  it("covers the four fixture scenarios", () => {
    for (const kind of ["normal", "memoryless", "defaults", "error"] as const) {
      expect(chatYouScenario(kind)["agents.list"]).toBeDefined();
    }
    expect(chatYouScenario("defaults")["sessions.create"]).toBeUndefined();
  });

  it("createChat is a stub until F2-02", async () => {
    await expect(
      createChat({ request: async () => null }, { agentId: "main", memoryless: true }),
    ).rejects.toThrow(/not implemented \(F2-02\)/);
  });
});

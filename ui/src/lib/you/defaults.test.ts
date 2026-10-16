import { describe, expect, it } from "vitest";
import {
  CHAT_YOU_AGENTS_LIST,
  CHAT_YOU_SESSION_DEFAULT_MODEL,
} from "../../e2e/chat-you-fixtures.test-support.ts";
import { saveYouDefaults, selectComposerDefaults } from "./defaults.ts";

describe("selectComposerDefaults", () => {
  it("uses the agent's own model and thinking default", () => {
    expect(selectComposerDefaults(CHAT_YOU_AGENTS_LIST, null, "main")).toEqual({
      agentId: "main",
      model: "openai/gpt-5.5",
      effort: "medium",
    });
  });

  it("falls back to the session default model when the agent names none", () => {
    expect(
      selectComposerDefaults(CHAT_YOU_AGENTS_LIST, CHAT_YOU_SESSION_DEFAULT_MODEL, "writer"),
    ).toEqual({ agentId: "writer", model: CHAT_YOU_SESSION_DEFAULT_MODEL, effort: "low" });
  });

  it("falls back to the default agent when the agent is unknown or omitted", () => {
    expect(selectComposerDefaults(CHAT_YOU_AGENTS_LIST, null, "ghost").agentId).toBe("main");
    expect(selectComposerDefaults(CHAT_YOU_AGENTS_LIST, null).agentId).toBe("main");
  });

  it("saveYouDefaults is a stub until F2-07", async () => {
    await expect(saveYouDefaults({ request: async () => null }, { model: null })).rejects.toThrow(
      /not implemented \(F2-07\)/,
    );
  });
});

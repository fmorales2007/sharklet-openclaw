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

  it("saveYouDefaults sends only what changed, with null clearing an override", async () => {
    const calls: { method: string; params: unknown }[] = [];
    const client = {
      request: async (method: string, params: unknown) => {
        calls.push({ method, params });
        return { ok: true, agentId: "main" };
      },
    } as never;
    expect((await saveYouDefaults(client, { agentId: "main", effort: "high" })).ok).toBe(true);
    expect((await saveYouDefaults(client, { agentId: "main", model: null, effort: null })).ok).toBe(
      true,
    );
    expect(calls.map((c) => c.params)).toEqual([
      { agentId: "main", thinkingDefault: "high" },
      { agentId: "main", model: null, thinkingDefault: null },
    ]);
  });

  it("saveYouDefaults rejects an unexpected field before any call", async () => {
    let called = false;
    const client = {
      request: async () => {
        called = true;
      },
    } as never;
    const result = await saveYouDefaults(client, { agentId: "main", model: 7 as never });
    expect(result.ok).toBe(false);
    expect(called).toBe(false);
  });
});

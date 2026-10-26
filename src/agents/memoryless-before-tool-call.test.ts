// F2-09: the step before every tool call is the second barrier for a Memory-less run.
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { runBeforeToolCallHook } from "./agent-tools.before-tool-call.policy.js";

const workspaceDir = path.join(os.tmpdir(), "openclaw-memoryless-tool");

describe("runBeforeToolCallHook in a Memory-less run", () => {
  const ctx = { memoryless: true, workspaceDir, cwd: workspaceDir, sessionKey: "agent:main:main" };

  it("vetoes a memory tool with the reason the model can act on", async () => {
    const outcome = await runBeforeToolCallHook({
      toolName: "memory_search",
      params: { query: "x" },
      ctx,
    });
    expect(outcome).toMatchObject({ blocked: true, deniedReason: "memoryless" });
    expect(outcome.blocked && outcome.reason).toMatch(/nothing is saved to memory/);
  });

  it("vetoes writing MEMORY.md with a generic file tool", async () => {
    const outcome = await runBeforeToolCallHook({
      toolName: "write",
      params: { path: "MEMORY.md", content: "remember this" },
      ctx,
    });
    expect(outcome).toMatchObject({ blocked: true, deniedReason: "memoryless" });
  });

  it("does not touch the same calls in an ordinary run", async () => {
    const outcome = await runBeforeToolCallHook({
      toolName: "write",
      params: { path: "MEMORY.md", content: "remember this" },
      ctx: { ...ctx, memoryless: undefined },
    });
    expect(outcome.blocked).toBe(false);
  });
});

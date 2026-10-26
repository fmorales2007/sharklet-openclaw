// F2-09: hooks of plugins that declare the "memory" category do not run in a Memory-less
// chat. Other plugins' hooks run as always.
import { describe, expect, it, vi } from "vitest";
import { createHookRunner } from "./hooks.js";
import { TEST_PLUGIN_AGENT_CTX, createMockPluginRegistry } from "./hooks.test-fixtures.js";
import type { PluginRegistry } from "./registry.js";

function registryWith(handlers: { memory: () => unknown; other: () => unknown }): PluginRegistry {
  const registry = createMockPluginRegistry([
    { hookName: "before_prompt_build", pluginId: "memory-like", handler: handlers.memory },
    { hookName: "before_prompt_build", pluginId: "other-plugin", handler: handlers.other },
  ]);
  for (const hook of registry.typedHooks) {
    if (hook.pluginId === "memory-like") {
      (hook as { memoryPlugin?: true }).memoryPlugin = true;
    }
  }
  return registry;
}

describe("before_prompt_build in a Memory-less run", () => {
  const event = { prompt: "hello", messages: [] };

  it("skips the memory plugin's hook and keeps the others", async () => {
    const memory = vi.fn(() => ({ prependContext: "FIXTURE-RECALL" }));
    const other = vi.fn(() => ({ prependContext: "FIXTURE-OTHER" }));
    const runner = createHookRunner(registryWith({ memory, other }));

    const result = await runner.runBeforePromptBuild(event, {
      ...TEST_PLUGIN_AGENT_CTX,
      memoryless: true,
    });

    expect(memory).not.toHaveBeenCalled();
    expect(other).toHaveBeenCalledOnce();
    expect(result?.prependContext).toContain("FIXTURE-OTHER");
    expect(result?.prependContext ?? "").not.toContain("FIXTURE-RECALL");
  });

  it("runs both in an ordinary chat", async () => {
    const memory = vi.fn(() => ({ prependContext: "FIXTURE-RECALL" }));
    const other = vi.fn(() => ({ prependContext: "FIXTURE-OTHER" }));
    const runner = createHookRunner(registryWith({ memory, other }));

    const result = await runner.runBeforePromptBuild(event, TEST_PLUGIN_AGENT_CTX);

    expect(memory).toHaveBeenCalledOnce();
    expect(other).toHaveBeenCalledOnce();
    expect(result?.prependContext).toContain("FIXTURE-RECALL");
  });
});

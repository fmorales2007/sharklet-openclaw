/* @vitest-environment jsdom */

import { render } from "lit";
import { afterEach, describe, expect, it, vi } from "vitest";
import { registerYouEnglish } from "../../i18n/locales/en-you.ts";
import type { YouDraft } from "../../lib/you/draft.ts";
import { fileUsage } from "../../lib/you/limits.ts";
import { renderYou, type YouViewProps } from "./view.ts";

const EMPTY_DRAFT: YouDraft = {
  aboutYou: "",
  responseStyle: { tone: "direct", length: "balanced", notes: "" },
  rules: [],
  memory: "",
  model: "",
  effort: "",
};

function props(overrides: Partial<YouViewProps> = {}): YouViewProps {
  return {
    agents: [{ id: "main", name: "Main" }],
    agentId: "main",
    targets: new Set(["main"]),
    draft: EMPTY_DRAFT,
    loading: false,
    loadError: null,
    dirty: false,
    saving: false,
    problems: {},
    status: null,
    usage: {
      user: fileUsage("x".repeat(95), 100),
      agents: fileUsage("x".repeat(10), 100),
      memory: fileUsage("x".repeat(150), 100),
      total: fileUsage("x".repeat(20), 1000),
    },
    switches: { aboutYou: true, responseStyle: true, skillRules: false, memory: true },
    canWrite: true,
    onSwitch: vi.fn(),
    onAgent: vi.fn(),
    onTarget: vi.fn(),
    onDraft: vi.fn(),
    onRuleChange: vi.fn(),
    onRuleAdd: vi.fn(),
    onRuleRemove: vi.fn(),
    onSave: vi.fn(),
    onRetry: vi.fn(),
    ...overrides,
  };
}

afterEach(() => document.body.replaceChildren());

describe("You page size meters and switches", () => {
  it("draws a meter per file with the limit it was given and warns near and over it", async () => {
    registerYouEnglish();
    const container = document.body.appendChild(document.createElement("div"));
    render(renderYou(props()), container);

    const meters = [...container.querySelectorAll('[role="meter"]')];
    expect(meters.map((meter) => meter.getAttribute("aria-label"))).toEqual([
      "USER.md",
      "AGENTS.md",
      "MEMORY.md",
      "All three together",
    ]);
    expect(meters[0]?.getAttribute("aria-valuemax")).toBe("100");
    expect(meters[0]?.getAttribute("aria-valuenow")).toBe("95");
    const text = container.textContent ?? "";
    expect(text).toContain("USER.md is nearly full. Trim it before it passes the limit.");
    expect(text).toContain("MEMORY.md is past the size we advise.");
    expect(text).not.toContain("AGENTS.md is nearly full");
  });

  it("shows each piece's switch as the agent has it and reports a change", async () => {
    registerYouEnglish();
    const onSwitch = vi.fn();
    const container = document.body.appendChild(document.createElement("div"));
    render(renderYou(props({ onSwitch })), container);

    const switches = [...container.querySelectorAll("wa-switch")] as Array<
      HTMLElement & { checked: boolean }
    >;
    expect(switches.map((entry) => entry.checked)).toEqual([true, true, false, true]);
    switches[2]!.checked = true;
    switches[2]!.dispatchEvent(new Event("change"));
    expect(onSwitch).toHaveBeenCalledWith("skillRules", true);
  });

  it("hides the section until the gateway has answered", async () => {
    registerYouEnglish();
    const container = document.body.appendChild(document.createElement("div"));
    render(renderYou(props({ usage: null, switches: null })), container);
    expect(container.querySelector('[role="meter"]')).toBeNull();
  });
});

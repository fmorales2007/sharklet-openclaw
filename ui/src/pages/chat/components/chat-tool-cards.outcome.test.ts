/* @vitest-environment jsdom */

import { render } from "lit";
import { describe, expect, it, vi } from "vitest";
import type { ToolCard } from "../../../lib/chat/chat-types.ts";
import { renderToolCard } from "./chat-tool-cards.ts";

// Outcome presentation for tool cards: neutral collapsed rows, the expanded
// outcome line, and the compact progress_card receipt.
describe("tool-card outcomes", () => {
  it.each(["exec", "lookup"])(
    "keeps %s progress neutral in the row and the detail panel until failure",
    (name) => {
      const container = document.createElement("div");
      const onOpenSidebar = vi.fn();
      const card: ToolCard = {
        id: "progress",
        name,
        args: { command: "diagnostic" },
        outputText: '{"error":"progress sample"}',
        live: true,
        completed: false,
      };
      const show = () =>
        render(
          renderToolCard(card, { messageKey: "test-message", runActive: true, onOpenSidebar }),
          container,
        );
      show();
      expect(container.querySelector(".chat-tool-row--running")).not.toBeNull();
      expect(container.querySelector(".chat-tool-row__outcome")).toBeNull();
      container.querySelector<HTMLButtonElement>("button.chat-tool-row")?.click();
      expect(onOpenSidebar).toHaveBeenCalledWith(
        expect.objectContaining({ content: expect.stringContaining("### Tool output") }),
      );
      expect(onOpenSidebar.mock.calls[0]?.[0].content).not.toContain("### Tool error");

      card.completed = true;
      card.isError = false;
      show();
      expect(container.querySelector(".chat-tool-row--running")).toBeNull();
      expect(container.querySelector(".chat-tool-row__outcome")).toBeNull();
      card.isError = true;
      show();
      expect(container.querySelector(".chat-tool-row__outcome")?.textContent).toBe("failed");
    },
  );

  it("respects an explicit success flag even when the payload looks like an error", () => {
    const container = document.createElement("div");
    render(
      renderToolCard(
        {
          id: "msg:err:status-false",
          name: "web_search",
          outputText: JSON.stringify({
            error: "missing_brave_api_key",
          }),
          isError: false,
        },
        { messageKey: "test-message", expanded: false, onToggleExpanded: vi.fn() },
      ),
      container,
    );

    expect(container.textContent).toContain("Web Search");
    expect(container.textContent).not.toContain("Tool error");
    expect(container.querySelector(".chat-tool-msg-summary--error")).toBeNull();
    expect(container.querySelector(".chat-tool-msg-summary__error-badge")).toBeNull();
  });

  it.each([
    {
      args: {
        markdown: "Implementation is moving.",
        plan: [
          { step: "Inspect", status: "completed" },
          { step: "Implement", status: "in_progress" },
          { step: "Verify", status: "pending" },
        ],
      },
      expected: "Progress updated — 1/3 · Implement",
    },
    { args: { markdown: "Waiting on review." }, expected: "Progress note updated" },
  ])("renders progress_card as a compact receipt: $expected", ({ args, expected }) => {
    const container = document.createElement("div");
    render(
      renderToolCard(
        {
          id: `progress:${expected}`,
          name: "progress_card",
          args,
          outputText: "Progress card updated",
          completed: true,
        },
        { messageKey: "test-message", expanded: true, onToggleExpanded: vi.fn() },
      ),
      container,
    );

    expect(container.textContent?.trim()).toBe(expected);
    expect(container.querySelector("button")).toBeNull();
    expect(container.querySelector(".chat-tool-msg-body")).toBeNull();
    expect(container.textContent).not.toContain("Waiting on review.");
  });
});

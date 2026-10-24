/* @vitest-environment jsdom */

import { render } from "lit";
import { describe, expect, it, vi } from "vitest";
import type { SidebarContent } from "./chat-sidebar.ts";
import { renderToolCard, resolveToolRowText } from "./chat-tool-cards.ts";

describe("execution purpose cards", () => {
  it.each([
    { name: "exec", args: { code: "await tools.read({ path: 'README.md' })" } },
    { name: "exec", args: { command: "set -euo pipefail\npnpm test" } },
    {
      name: "exec",
      args: { command: "pnpm test", code: "await tools.read({ path: 'README.md' })" },
    },
    { name: "bash", args: { command: "pnpm test" } },
    { name: "shell", args: { command: "pnpm test" } },
  ])(
    "shows the agent purpose immediately for $name and retains execution details",
    ({ name, args }) => {
      const container = document.createElement("div");
      const card = {
        id: "msg:purpose",
        name,
        args: { ...args, title: "Check the workspace" },
        inputText: JSON.stringify(args),
        live: true,
        outputText: "workspace checked",
      };
      const onOpenSidebar = vi.fn<(content: SidebarContent) => void>();
      const options = { messageKey: "purpose", runActive: true, onOpenSidebar };
      render(renderToolCard(card, options), container);
      expect(container.querySelector(".chat-tool-row__title")?.textContent).toBe(
        "Check the workspace",
      );
      expect(container.querySelector(".chat-tool-row__cmd")).toBeNull();
      expect(resolveToolRowText(card, true)).toBe("Check the workspace");

      render(renderToolCard({ ...card, completed: true }, options), container);
      expect(container.querySelector(".chat-tool-row__title")?.textContent).toBe(
        "Check the workspace",
      );
      container.querySelector<HTMLButtonElement>("button.chat-tool-row")?.click();
      const details = onOpenSidebar.mock.calls[0]?.[0];
      if (details?.kind !== "markdown") {
        throw new Error("Expected tool details Markdown");
      }
      for (const source of Object.values(args)) {
        expect(details.content).toContain(JSON.stringify(source).slice(1, -1));
      }
      expect(details.content).toContain("workspace checked");
    },
  );

  it.each([
    { name: "calendar_create", args: { title: "Team meeting", command: "create" } },
    { name: "document_create", args: { title: "Design notes", content: "Draft" } },
  ])("does not treat $name business title arguments as activity descriptions", ({ name, args }) => {
    const container = document.createElement("div");
    render(
      renderToolCard({ id: "business-title", name, args }, { messageKey: "business-title" }),
      container,
    );
    expect(container.querySelector(".chat-tool-row__title")).toBeNull();
  });

  it("previews the useful command after shell setup while retaining the full command", () => {
    const container = document.createElement("div");
    const card = {
      id: "shell-preamble",
      name: "exec",
      args: { command: "set -euo pipefail\ncd /workspace\npnpm test" },
      inputText: "set -euo pipefail\ncd /workspace\npnpm test",
    };
    const onOpenSidebar = vi.fn<(content: SidebarContent) => void>();
    render(renderToolCard(card, { messageKey: "shell-preamble", onOpenSidebar }), container);
    expect(container.querySelector(".chat-tool-row__cmd")?.textContent).toBe("pnpm test");
    expect(resolveToolRowText(card)).toBe("$ pnpm test");
    container.querySelector<HTMLButtonElement>("button.chat-tool-row")?.click();
    expect(onOpenSidebar.mock.calls[0]?.[0]).toMatchObject({
      content: expect.stringContaining("cd /workspace"),
    });
  });
});

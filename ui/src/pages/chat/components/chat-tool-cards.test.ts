/* @vitest-environment jsdom */

import { render } from "lit";
import { describe, expect, it, vi } from "vitest";
import {
  formatDistinctCollapsedToolSummaryText,
  formatCollapsedToolPreviewText,
  formatCollapsedToolSummaryText,
  resolveCollapsedToolArgumentPreview,
} from "../../../lib/chat/tool-cards.ts";
import { renderMessageActionButtons } from "./chat-message-markdown.ts";
import { renderWorkGroupSummary } from "./chat-message-stream.ts";
import { renderToolCard, renderToolPreview } from "./chat-tool-cards.ts";

describe("tool-cards", () => {
  it("routes MCP App previews through the dedicated double-iframe host", async () => {
    const container = document.createElement("div");
    render(
      renderToolPreview(
        {
          kind: "canvas",
          surface: "assistant_message",
          render: "url",
          viewId: "cv_app",
          mcpApp: { viewId: "cv_app" },
        },
        "chat_message",
        { sessionKey: "agent:main:main" },
      ),
      container,
    );

    const view = container.querySelector("mcp-app-view");
    expect(view).not.toBeNull();
    expect(view?.getAttribute("src")).toBeNull();
    expect((view as { sessionKey?: string }).sessionKey).toBe("agent:main:main");
    expect((view as { viewId?: string }).viewId).toBe("cv_app");
    expect((view as { height?: number }).height).toBe(600);
    await customElements.whenDefined("mcp-app-view");
    expect(customElements.get("mcp-app-view")).toBeDefined();
    expect((view as { sessionKey?: string }).sessionKey).toBe("agent:main:main");
    expect((view as { viewId?: string }).viewId).toBe("cv_app");

    const toolContainer = document.createElement("div");
    render(
      renderToolPreview(
        {
          kind: "canvas",
          surface: "assistant_message",
          render: "url",
          mcpApp: { viewId: "cv_app" },
        },
        "chat_tool",
        { sessionKey: "agent:main:main" },
      ),
      toolContainer,
    );
    expect(toolContainer.querySelector("mcp-app-view")).toBeNull();
  });

  it("keeps ordinary canvas previews off the MCP Apps chunk", () => {
    const container = document.createElement("div");
    render(
      renderToolPreview(
        {
          kind: "canvas",
          surface: "assistant_message",
          render: "url",
          viewId: "cv_canvas",
          url: "https://canvas.example/widget",
        },
        "chat_message",
        { allowExternalEmbedUrls: true },
      ),
      container,
    );

    expect(container.querySelector("iframe")).not.toBeNull();
  });

  it.each([
    {
      label: "multi-file",
      patch: [
        "*** Begin Patch",
        "*** Update File: src/a.ts",
        "@@",
        "-old",
        "+new",
        "*** Add File: src/b.ts",
        "+added",
        "*** End Patch",
      ].join("\n"),
      target: "2 files",
    },
    {
      label: "moved",
      patch: [
        "*** Begin Patch",
        "*** Update File: src/old.ts",
        "*** Move to: src/new.ts",
        "@@",
        "-old",
        "+new",
        "*** End Patch",
      ].join("\n"),
      target: "old.ts → new.ts",
    },
    {
      // A successful delete removes its own target, so the workspace loader
      // would only ever report "Failed to load".
      label: "deleted",
      patch: ["*** Begin Patch", "*** Delete File: src/gone.ts", "*** End Patch"].join("\n"),
      target: "gone.ts",
    },
  ])("keeps $label patch summaries non-navigable", ({ patch, target }) => {
    const container = document.createElement("div");
    const onOpenWorkspaceFile = vi.fn();
    const onOpenSidebar = vi.fn();
    render(
      renderToolCard(
        {
          id: `msg:patch:${target}`,
          name: "apply_patch",
          args: { patch },
          completed: true,
        },
        { messageKey: "test-message", onOpenWorkspaceFile, onOpenSidebar },
      ),
      container,
    );

    expect(container.querySelector(".chat-tool-row--file")).toBeNull();
    expect(container.querySelector(".chat-tool-row__target")?.textContent).toBe(target);
    container.querySelector<HTMLButtonElement>(".chat-tool-msg-summary")?.click();
    expect(onOpenSidebar).toHaveBeenCalledOnce();
    expect(onOpenWorkspaceFile).not.toHaveBeenCalled();
  });

  it.each([
    { name: "read", args: { path: "packages/app/src/read.ts" }, path: "packages/app/src/read.ts" },
    {
      name: "edit",
      args: { file_path: "packages/app/src/edit.ts", oldText: "old", newText: "new" },
      path: "packages/app/src/edit.ts",
    },
    {
      name: "write",
      args: { path: "packages/app/src/write.ts", content: "new" },
      path: "packages/app/src/write.ts",
    },
  ])("opens the file from the $name row", ({ name, args, path }) => {
    const container = document.createElement("div");
    const onOpenWorkspaceFile = vi.fn();
    render(
      renderToolCard(
        {
          id: `msg:${name}:open`,
          name,
          args,
          completed: true,
        },
        { messageKey: "test-message", onOpenWorkspaceFile },
      ),
      container,
    );

    const pathButton = container.querySelector<HTMLButtonElement>(
      '.chat-tool-row__file-link[title="Open file"]',
    );
    expect(pathButton).toBeInstanceOf(HTMLButtonElement);
    pathButton!.click();
    expect(onOpenWorkspaceFile).toHaveBeenCalledWith({ path });
  });

  it("previews common intent arguments across generic tools", () => {
    expect(resolveCollapsedToolArgumentPreview({ task: "Review the PR" })).toBe("Review the PR");
    expect(resolveCollapsedToolArgumentPreview({ prompt: "Draw a crab" })).toBe("Draw a crab");
    expect(resolveCollapsedToolArgumentPreview({ text: "First line\nSecond line" })).toBe(
      "First line",
    );
    expect(resolveCollapsedToolArgumentPreview({ query: " \r\rSecond line" })).toBe("Second line");
    const credential = ["sk", "1234567890abcdef"].join("-");
    expect(
      resolveCollapsedToolArgumentPreview({ description: `OPENAI_API_KEY=${credential}` }),
    ).not.toContain(credential);
  });

  it("normalizes collapsed summary text for display only", () => {
    expect(formatCollapsedToolSummaryText("  with   Example Deck  ")).toBe("Example Deck");
    expect(formatCollapsedToolSummaryText("Example Deck")).toBe("Example Deck");
    expect(formatCollapsedToolSummaryText("   ")).toBeUndefined();
  });

  it("omits normalized tool details that repeat the label", () => {
    expect(formatDistinctCollapsedToolSummaryText("bash", "Bash")).toBeUndefined();
    expect(
      formatDistinctCollapsedToolSummaryText("heartbeat_respond", "Heartbeat Respond"),
    ).toBeUndefined();
    expect(formatDistinctCollapsedToolSummaryText("run openclaw doctor", "Bash")).toBe(
      "run openclaw doctor",
    );
  });

  it("keeps collapsed markdown previews bounded after display cleanup", () => {
    const preview = formatCollapsedToolPreviewText(`with ${"A".repeat(200)}`);

    expect(formatCollapsedToolPreviewText("First line\nSecond line")).toBe(
      "First line Second line",
    );
    expect(preview).toHaveLength(120);
    expect(preview?.startsWith("A")).toBe(true);
    expect(preview).not.toContain("with ");
    expect(formatCollapsedToolPreviewText(`${"A".repeat(119)}🚀tail`)).toBe("A".repeat(119));
  });

  it("bounds raw string argument fallbacks in collapsed summaries", () => {
    const container = document.createElement("div");
    const rawInput = `with ${"A".repeat(200)}`;
    render(
      renderToolCard(
        {
          id: "msg:5c:call-5c",
          name: "presentation_create",
          args: rawInput,
          inputText: rawInput,
        },
        { messageKey: "test-message", expanded: false, onToggleExpanded: vi.fn() },
      ),
      container,
    );

    const labelText = container.querySelector(".chat-tool-msg-summary__label")?.textContent?.trim();
    expect(labelText).toHaveLength(120);
    expect(labelText?.startsWith("A")).toBe(true);
    expect(labelText).not.toContain("with ");
  });

  it("renders a step as a flat line that opens its details in the panel", () => {
    const container = document.createElement("div");
    const onOpenSidebar = vi.fn();
    render(
      renderToolCard(
        { id: "msg:flat", name: "web_search", args: { query: "openclaw" }, completed: true },
        { messageKey: "test-message", onOpenSidebar },
      ),
      container,
    );
    const row = container.querySelector<HTMLButtonElement>("button.chat-tool-row");
    expect(row?.hasAttribute("aria-expanded")).toBe(false);
    expect(container.querySelector(".chat-tool-row__chevron")).toBeNull();
    row?.click();
    expect(onOpenSidebar).toHaveBeenCalledOnce();
  });

  it("keeps a step without a detail panel as plain text and marks a failure on the line", () => {
    const container = document.createElement("div");
    render(
      renderToolCard(
        {
          id: "msg:failed",
          name: "exec",
          args: { command: "pnpm test" },
          completed: true,
          isError: true,
          exitCode: 2,
        },
        { messageKey: "test-message" },
      ),
      container,
    );
    expect(container.querySelector("button")).toBeNull();
    expect(container.querySelector(".chat-tool-row__outcome")?.textContent).toBe("Exit code 2");
  });

  it("renders the work summary as a static line, not a disclosure", () => {
    const container = document.createElement("div");
    render(renderWorkGroupSummary({ key: "work:1", durationMs: 41_000 }), container);
    expect(container.querySelector("button")).toBeNull();
    expect(container.querySelector(".chat-activity-group__label")?.textContent).toContain("41s");
  });

  it("offers retry beside copy only when the owner passes a retry action", () => {
    const retry = vi.fn();
    const container = document.createElement("div");
    render(renderMessageActionButtons({ markdown: "Reply" }, { onRetry: retry }), container);
    container.querySelector<HTMLButtonElement>(".chat-retry-btn")?.click();
    expect(retry).toHaveBeenCalledOnce();
    render(renderMessageActionButtons({ markdown: "Reply" }, {}), container);
    expect(container.querySelector(".chat-retry-btn")).toBeNull();
  });
});

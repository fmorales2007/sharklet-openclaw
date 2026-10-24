import { asNullableRecord } from "@openclaw/normalization-core/record-coerce";
import { html, nothing } from "lit";
import { icons } from "../../../components/icons.ts";
import { isMarkdownBlockArtText } from "../../../components/markdown-text.ts";
import "../../../components/tooltip.ts";
import { t } from "../../../i18n/index.ts";
import type { ToolCard } from "../../../lib/chat/chat-types.ts";
import type { ToolCallView } from "../../../lib/chat/tool-call-view.ts";
import {
  isToolCardError,
  resolveToolCardOutcome,
  type ToolPreview,
} from "../../../lib/chat/tool-cards.ts";
import { formatToolDetail, resolveToolDisplay } from "../../../lib/chat/tool-display.ts";
import type { SidebarContent } from "./chat-sidebar.ts";

function formatToolOutputForSidebar(text: string): string {
  if (isMarkdownBlockArtText(text)) {
    return "```\n" + text + "\n```";
  }

  const trimmed = text.trim();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      JSON.parse(trimmed);
      // Keep the source literal: reserialization can change numbers, escapes, and duplicate keys.
      return "```json\n" + trimmed + "\n```";
    } catch {
      return text;
    }
  }
  return text;
}

function formatPayloadForSidebar(
  text: string | undefined,
  language: "json" | "text" = "text",
): string {
  if (!text?.trim()) {
    return "";
  }
  if (language === "json") {
    return `\`\`\`json
${text}
\`\`\``;
  }
  const formatted = formatToolOutputForSidebar(text);
  if (formatted.includes("```")) {
    return formatted;
  }
  return `\`\`\`text
${text}
\`\`\``;
}

function buildToolCardSidebarContent(card: ToolCard): string {
  const display = resolveToolDisplay({ name: card.name, args: card.args });
  const detail = formatToolDetail(display);
  const isError = isToolCardError(card);
  const outcome = resolveToolCardOutcome(card, false);
  const sections = [`## ${display.label}`, `**${t("chat.toolCards.tool")}:** \`${display.name}\``];

  if (detail) {
    sections.push(`**${t("chat.toolCards.summary")}:** ${detail}`);
  }

  if (card.inputText?.trim()) {
    const inputIsJson = typeof card.args === "object" && card.args !== null;
    sections.push(
      `### ${t("chat.toolCards.toolInput")}\n${formatPayloadForSidebar(card.inputText, inputIsJson ? "json" : "text")}`,
    );
  }

  if (card.outputText?.trim()) {
    sections.push(
      `### ${t(isError ? "chat.toolCards.toolError" : "chat.toolCards.toolOutput")}\n${formatToolOutputForSidebar(card.outputText)}`,
    );
  } else {
    sections.push(
      isError
        ? `### ${t("chat.toolCards.toolError")}\n*${t("chat.toolCards.noOutputFailed")}*`
        : outcome === "succeeded"
          ? `### ${t("chat.toolCards.toolOutput")}\n*${t("chat.toolCards.noOutputSucceeded")}*`
          : `### ${t("chat.toolCards.toolOutput")}\n*${t("chat.toolCards.noResult")}*`,
    );
  }

  return sections.join("\n\n");
}

function handleRawDetailsToggle(event: Event) {
  // SAFETY: This handler is attached only to the raw-details button below.
  const button = event.currentTarget as HTMLButtonElement | null;
  const root = button?.closest(".chat-tool-card__raw");
  const body = root?.querySelector<HTMLElement>(".chat-tool-card__raw-body");
  if (!button || !body) {
    return;
  }
  const expanded = button.getAttribute("aria-expanded") === "true";
  button.setAttribute("aria-expanded", String(!expanded));
  body.hidden = expanded;
}

function buildSidebarContent(value: string, options?: { rawText?: string | null }): SidebarContent {
  return {
    kind: "markdown",
    content: value,
    ...(options?.rawText ? { rawText: options.rawText } : {}),
  };
}

function buildPreviewSidebarContent(
  preview: ToolPreview,
  rawText?: string | null,
): SidebarContent | null {
  if (preview.kind !== "canvas" || preview.render !== "url" || !preview.viewId || !preview.url) {
    return null;
  }
  return {
    kind: "canvas",
    docId: preview.viewId,
    entryUrl: preview.url,
    ...(preview.title ? { title: preview.title } : {}),
    ...(preview.preferredHeight ? { preferredHeight: preview.preferredHeight } : {}),
    // The per-preview sandbox ceiling must survive the sidebar conversion, or a
    // trusted global embed mode would re-grant same-origin to widget script.
    ...(preview.sandbox ? { sandbox: preview.sandbox } : {}),
    ...(rawText ? { rawText } : {}),
  };
}

export function renderRawOutputToggle(text: string) {
  return html`
    <div class="chat-tool-card__raw">
      <button
        class="chat-inline-disclosure chat-tool-card__raw-toggle"
        type="button"
        aria-expanded="false"
        @click=${handleRawDetailsToggle}
      >
        <span>${t("chat.toolCards.rawDetails")}</span>
        <span class="chat-inline-disclosure__chevron" aria-hidden="true">${icons.chevronDown}</span>
      </button>
      <div class="chat-tool-card__raw-body" hidden>${renderToolDataBlock({ text })}</div>
    </div>
  `;
}

// Plain tool output is the block's default content, so it carries no header;
// only input/error blocks need a label to stay distinguishable.
function renderToolDataBlock(params: { label?: string; text: string }) {
  const { label, text } = params;
  const codeClass = isMarkdownBlockArtText(text) ? "markdown-block-art" : "";
  return html`
    <div class="chat-tool-card__block">
      ${
        label
          ? html`<div class="chat-tool-card__block-header">
              <span class="chat-tool-card__block-icon">${icons.zap}</span>
              <span class="chat-tool-card__block-label">${label}</span>
            </div>`
          : nothing
      }
      <pre class="chat-tool-card__block-content"><code class=${codeClass}>${text}</code></pre>
    </div>
  `;
}

export function toolWorkspacePath(card: ToolCard, view: ToolCallView): string | null {
  if (view.kind !== "read" && view.kind !== "edit" && view.kind !== "write") {
    return null;
  }
  const singleOperation = view.fileOperations?.length === 1 ? view.fileOperations[0] : undefined;
  // A delete removes its own target, so the workspace loader would always
  // report "Failed to load"; the row keeps its disclosure but no file action.
  if (singleOperation?.operation === "delete") {
    return null;
  }
  const args = asNullableRecord(card.args);
  if (args) {
    for (const key of ["path", "file_path", "filePath", "notebook_path"]) {
      const value = args[key];
      if (typeof value === "string" && value.trim()) {
        return value;
      }
    }
  }
  const fallback = `${view.targetDetail ? `${view.targetDetail}/` : ""}${view.target ?? ""}`;
  const fallbackPath = fallback.trim();
  // Aggregate patch labels ("2 files", "a.ts → b.ts") name no single file, so
  // only a recorded operation matching the rendered path stays navigable.
  if (view.fileOperations) {
    return singleOperation?.path === fallbackPath ? singleOperation.path : null;
  }
  return fallbackPath || null;
}

/** The failure a step line carries, since its output opens in the detail panel. */
export function toolFailureLabel(card: ToolCard): string | null {
  if (!isToolCardError(card)) {
    return null;
  }
  return card.exitCode === undefined
    ? t("chat.toolCards.failed")
    : t("chat.toolCards.exitCode", { code: String(card.exitCode) });
}

export type ToolRenderOptions = {
  messageKey: string;
  sessionKey?: string;
  agentId?: string;
  presented?: boolean;
  runActive?: boolean;
  onOpenSidebar?: (content: SidebarContent) => void;
  onOpenWorkspaceFile?: (target: { path: string; line?: number | null }) => void;
};

/** Tool output as the detail panel shows it: JSON stays literal, never parsed as Markdown. */
export function toolOutputSidebarContent(text: string): SidebarContent {
  return buildSidebarContent(formatToolOutputForSidebar(text), { rawText: text });
}

/** What the detail panel shows for a tool step: its input, output and outcome. */
export function toolCardSidebarContent(card: ToolCard): SidebarContent {
  const preview =
    card.preview?.kind === "canvas"
      ? buildPreviewSidebarContent(card.preview, card.outputText)
      : null;
  return (
    preview ??
    buildSidebarContent(buildToolCardSidebarContent(card), { rawText: card.outputText ?? null })
  );
}

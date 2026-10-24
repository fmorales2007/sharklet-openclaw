import { html, nothing } from "lit";
import type { QuestionPrompt } from "../../../app/question-prompt.ts";
import { t } from "../../../i18n/index.ts";
import type { AssistantIdentity } from "../../../lib/assistant-identity.ts";
import type { ChatItem } from "../../../lib/chat/chat-types.ts";
import { formatDurationCompact } from "../../../lib/format.ts";
import { renderChatAvatar } from "../chat-avatar.ts";
import { renderGroupedMessage } from "./chat-message-bubble.ts";
import {
  prepareChatMessageRender,
  resolveMessageActionDetails,
  type MessageReplyTarget,
} from "./chat-message-markdown.ts";
import { renderChatTimestamp } from "./chat-message-timestamp.ts";
import { renderChatQuestionSummary } from "./chat-question-card.ts";
import type { SidebarContent } from "./chat-sidebar.ts";
import { renderChatWorkingIndicator } from "./chat-working-indicator.ts";

/** A contiguous run of in-flight streaming items rendered under one assistant group. */
export type StreamGroupPart = Extract<
  ChatItem,
  { kind: "stream" } | { kind: "reading-indicator" } | { kind: "question" }
>;

type StreamMessageOptions = Pick<
  Parameters<typeof renderGroupedMessage>[2],
  | "sessionKey"
  | "presented"
  | "boardProvider"
  | "agentId"
  | "runActive"
  | "onRequestUpdate"
  | "canvasPluginSurfaceUrl"
  | "resourceBasePath"
  | "mediaPolicyKey"
  | "connectionEpoch"
  | "assistantAttachmentAuthToken"
  | "resolveArtifactDownload"
  | "onRequestOpenImage"
  | "onOpenImage"
  | "onAssistantAttachmentLoaded"
  | "embedSandboxMode"
  | "allowExternalEmbedUrls"
  | "fetchLinkFavicon"
  | "githubRepo"
  | "onOpenWorkspaceFile"
>;

export type StreamGroupOptions = StreamMessageOptions & {
  onReply?: (target: MessageReplyTarget) => void;
  onOpenSidebar?: (content: SidebarContent) => void;
  assistant?: AssistantIdentity;
  showAssistantAvatar?: boolean;
  startupLabel?: string;
  waitingApproval?: boolean;
  runOutputTokens?: number | null;
  /** The session's effort level; the working shark swims at its speed. */
  thinkingLevel?: string | null;
  questionPrompts?: ReadonlyMap<string, QuestionPrompt>;
};

export function renderStreamGroupParts(
  parts: StreamGroupPart[],
  opts: StreamGroupOptions,
  presentation: "standalone" | "continuation",
) {
  return parts.map((part) => {
    if (part.kind === "reading-indicator") {
      return renderChatWorkingIndicator(part, {
        waitingApproval: opts.waitingApproval === true,
        startupLabel: opts.startupLabel,
        outputTokens: opts.runOutputTokens,
        effort: opts.thinkingLevel,
        presentation,
      });
    }
    if (part.kind === "question") {
      const prompt = opts.questionPrompts?.get(part.questionId);
      return prompt ? renderChatQuestionSummary(prompt) : nothing;
    }
    const source = prepareChatMessageRender({
      role: "assistant",
      content: [{ type: "text", text: part.text }],
      timestamp: part.startedAt,
    });
    return renderGroupedMessage(
      source,
      part.key,
      {
        ...opts,
        isStreaming: part.isStreaming,
        showReasoning: false,
        // Settled segments can be replied to without transcript IDs or footer actions.
        messageActions: resolveMessageActionDetails(source, {
          messageId: part.key,
          onReply: opts.onReply,
          senderLabel: opts.assistant?.name ?? "Assistant",
        }),
      },
      opts.onOpenSidebar,
    );
  });
}

// One assistant group per contiguous run of streaming items: a reply that
// arrives as several stream segments renders under a single avatar/footer
// instead of flashing a separate avatar+bubble per segment (#63956).
export function renderStreamGroup(parts: StreamGroupPart[], opts: StreamGroupOptions = {}) {
  const { assistant, resourceBasePath } = opts;
  const name = assistant?.name ?? "Assistant";
  // Footer (sender + time) anchors to the earliest streamed segment; a run that
  // is only the reading indicator has no timestamp and therefore no footer.
  const streamStarts = parts.flatMap((part) => (part.kind === "stream" ? [part.startedAt] : []));
  const footerStartedAt = streamStarts.length > 0 ? Math.min(...streamStarts) : null;
  const active = parts.some(
    (part) => part.kind === "reading-indicator" || (part.kind === "stream" && part.isStreaming),
  );
  // While the agent works with nothing streamed yet the run is pure claw: no
  // avatar next to it - the punching pincer is the whole signal. The avatar
  // arrives with the first stream part unless the presentation opts out.
  const workingOnly = parts.every((part) => part.kind !== "stream");
  const avatar =
    workingOnly || opts.showAssistantAvatar === false
      ? nothing
      : renderChatAvatar("assistant", assistant, undefined, resourceBasePath);
  const groupClass = `chat-group assistant${workingOnly ? " chat-group--working" : ""}${footerStartedAt !== null ? " chat-group--with-footer" : ""}`;

  return html`
    <div class=${groupClass} data-chat-row-key=${parts[0]?.key ?? nothing}>
      ${avatar}
      <div class="chat-group-messages">${renderStreamGroupParts(parts, opts, "standalone")}</div>
      ${
        footerStartedAt !== null && !active
          ? html`
              <div class="chat-group-footer">
                <div class="chat-group-footer__meta">
                  <span class="chat-sender-name">${name}</span>
                  ${renderChatTimestamp(footerStartedAt)}
                </div>
              </div>
            `
          : nothing
      }
    </div>
  `;
}

/**
 * Summary line of a completed turn's intermediate work: "Worked for X". The
 * work itself stays in the thread as step lines right after it; the check icon
 * is the turn's done indicator.
 */
export function renderWorkGroupSummary(
  item: { key: string; durationMs: number | null },
  opts: { presentation?: "standalone" | "continuation" } = {},
) {
  const duration = formatDurationCompact(item.durationMs);
  const label = duration ? t("chat.workRun.workedFor", { duration }) : t("chat.workRun.worked");
  const content = html`
    <div class="chat-activity-group chat-work-group">
      <div class="chat-activity-group__summary">
        <span class="chat-activity-group__label" title=${label}>${label}</span>
      </div>
      <div class="chat-work-group__separator" aria-hidden="true"></div>
    </div>
  `;
  return opts.presentation === "continuation"
    ? content
    : html`
        <div class="chat-group tool chat-group--work" data-chat-row-key=${item.key}>
          <div class="chat-group-messages">${content}</div>
        </div>
      `;
}

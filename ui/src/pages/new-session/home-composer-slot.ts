import { html, nothing, type TemplateResult } from "lit";
import type { GatewayAgentRow } from "../../api/types.ts";
import type { ApplicationContext } from "../../app/context.ts";
import { hasOperatorWriteAccess } from "../../app/operator-access.ts";
import { icons } from "../../components/icons.ts";
import type { ImageLightboxItem } from "../../components/image-lightbox.ts";
import { t } from "../../i18n/index.ts";
import type { HumanMention } from "../../lib/chat/chat-types.ts";
import type { SessionToolOverrides } from "../../lib/sessions/patch.ts";
import { countSessionToolOverrides } from "../../lib/sessions/tool-overrides.ts";
import { refreshSlashCommands } from "../chat/chat-commands.ts";
import { ownsHomeCommands } from "../chat/components/chat-composer-home.ts";
import { getChatComposerState } from "../chat/components/chat-composer-state.ts";
import {
  HOME_COMPOSER_PANE_ID,
  type CapabilityMenuProps,
  type ChatComposerProps,
} from "../chat/components/chat-composer-types.ts";
import { renderChatComposer } from "../chat/components/chat-composer.ts";
import type { ChatPermissionPickerProps } from "../chat/components/chat-permission-picker.ts";
import type { NewSessionAttachmentDraft } from "./attachment-draft.ts";
import type { NewSessionVisibility } from "./create-params.ts";
import type { NewSessionModelControl } from "./model-control.ts";

type HomeComposerOptions = {
  agent?: GatewayAgentRow;
  agentId: string;
  attachmentDraft: NewSessionAttachmentDraft;
  canSubmit: boolean;
  context: ApplicationContext | undefined;
  draftOwnerKey: string;
  isCatalogTarget: boolean;
  header: TemplateResult;
  message: string;
  mentions?: readonly HumanMention[];
  getMentions?: () => readonly HumanMention[];
  visibility?: NewSessionVisibility;
  draftAvailable?: boolean;
  memoryless?: boolean;
  onMemorylessChange?: (memoryless: boolean) => void;
  capabilityMenu?: CapabilityMenuProps;
  toolOverrides?: SessionToolOverrides | null;
  modelControl: NewSessionModelControl;
  permissionPicker?: ChatPermissionPickerProps;
  voiceControl?: TemplateResult | typeof nothing;
  requiresModifier: boolean;
  requestUpdate: () => void;
  submitDisabledReason?: string;
  blockedSubmitNotice?: string;
  dictationActive?: boolean;
  dictationPreview?: string;
  dictationStatus?: TemplateResult | typeof nothing;
  onUnsupportedAttachment?: () => void;
  submitting: boolean;
  messageLocked?: boolean;
  onInput: (message: string, mentions?: readonly HumanMention[]) => void;
  onOpenImage?: (item: ImageLightboxItem) => void;
  onVisibilityChange?: (visibility: NewSessionVisibility) => void;
  onSubmit: () => void;
  onBackgroundSubmit?: () => void;
};

function renderDraftVisibility(options: {
  active: boolean;
  disabled: boolean;
  onChange: (visibility: NewSessionVisibility) => void;
}) {
  const label = t("newSession.draft");
  return html`
    <button
      type="button"
      class="new-session-page__visibility new-session-page__visibility--draft ${
        options.active ? "new-session-page__visibility--active" : ""
      }"
      role="switch"
      aria-label=${label}
      aria-checked=${String(options.active)}
      ?disabled=${options.disabled}
      title=${t("newSession.draftDescription")}
      @click=${() => options.onChange(options.active ? "normal" : "draft")}
    >
      <span class="new-session-page__visibility-icon" aria-hidden="true">${icons.pencil}</span>
      <span class="new-session-page__visibility-label">${label}</span>
    </button>
  `;
}

function renderSelectionStatus(options: {
  toolOverrides?: SessionToolOverrides | null;
  disabled: boolean;
  requestUpdate: () => void;
}) {
  const overrideCount = countSessionToolOverrides(options.toolOverrides);
  if (overrideCount === 0) {
    return nothing;
  }
  const openMenu = () => {
    const state = getChatComposerState(HOME_COMPOSER_PANE_ID);
    state.capabilityMenuView = "root";
    state.capabilityMenuOpen = true;
    options.requestUpdate();
  };
  return html`
    <button
      type="button"
      class="new-session-page__selection-status"
      ?disabled=${options.disabled}
      @click=${openMenu}
    >
      ${t(
        overrideCount === 1 ? "chat.composer.overrides.countOne" : "chat.composer.overrides.count",
        { count: String(overrideCount) },
      )}
    </button>
  `;
}

/** Fills the chat composer's props for Home: no session yet, so the Start slot replaces sending. */
export function renderHomeComposer(options: HomeComposerOptions) {
  const { attachmentDraft, submitting, isCatalogTarget } = options;
  const readSignal = attachmentDraft.readSignal;
  const messageLocked = options.messageLocked === true;
  const dictationActive = options.dictationActive === true;
  const gateway = options.context?.gateway;
  const commandClient = isCatalogTarget ? null : (gateway?.snapshot.client ?? null);
  const profile = gateway?.snapshot.selfUser?.identity;
  const mentionDirectory =
    gateway &&
    commandClient &&
    !dictationActive &&
    gateway.snapshot.phase === "connected" &&
    profile?.type === "profile" &&
    hasOperatorWriteAccess(gateway.snapshot.hello?.auth ?? null) &&
    !isCatalogTarget &&
    options.visibility !== "incognito"
      ? {
          client: commandClient,
          ownerKey: JSON.stringify([
            gateway.connectionRevision,
            commandClient.recoveryScope,
            profile.id,
            options.draftOwnerKey,
          ]),
          params: {
            agentId: options.agentId,
            ...(options.visibility === "draft" ? { visibility: "draft" as const } : {}),
          },
        }
      : undefined;
  const locked = submitting || messageLocked;
  const draftEnabled = options.visibility === "draft";
  const modelControl = isCatalogTarget
    ? nothing
    : options.modelControl.render({
        agent: options.agent,
        agentId: options.agentId,
        context: options.context,
        sending: submitting,
      });
  const props: ChatComposerProps = {
    paneId: HOME_COMPOSER_PANE_ID,
    sessionKey: options.draftOwnerKey,
    currentAgentId: options.agentId,
    connected: gateway?.snapshot.phase === "connected",
    canSend: !locked,
    disabledReason: options.blockedSubmitNotice ?? null,
    disabledReasonTone: "info",
    sending: submitting,
    messages: [],
    stream: null,
    queue: [],
    draft: options.message,
    getDraft: () => options.message,
    mentions: options.mentions,
    getMentions: options.getMentions,
    mentionDirectory,
    modelCatalog: [],
    modelSwitching: false,
    sessions: null,
    assistantName: "",
    capabilityMenu: options.capabilityMenu,
    toolOverrides: options.toolOverrides ?? undefined,
    composerControls:
      modelControl === nothing
        ? nothing
        : html`<div class="chat-composer-model-control">${modelControl}</div>`,
    permissionPicker: options.permissionPicker,
    attachmentLimits: gateway?.snapshot.hello?.policy?.attachments,
    attachments: attachmentDraft.attachments,
    getAttachments: () => attachmentDraft.attachments,
    pendingAttachmentReads: attachmentDraft.pendingReads,
    readSignal,
    onAttachmentsChange: (attachments) => {
      if (!locked) {
        attachmentDraft.replace(attachments);
      }
    },
    onPendingReadsChange: (delta) => attachmentDraft.updatePending(readSignal, delta),
    onOpenImage: options.onOpenImage,
    onRequestUpdate: options.requestUpdate,
    onDraftChange: options.onInput,
    onSlashIntent: commandClient
      ? () =>
          refreshSlashCommands({
            client: commandClient,
            agentId: options.agentId,
            shouldApply: () =>
              ownsHomeCommands(
                getChatComposerState(HOME_COMPOSER_PANE_ID),
                commandClient,
                options.agentId,
                options.draftOwnerKey,
              ),
          })
      : undefined,
    onSend: options.onSubmit,
    onQueueRemove: () => {},
    home: {
      header: options.header,
      leadControls: isCatalogTarget
        ? nothing
        : html`${
            options.draftAvailable
              ? renderDraftVisibility({
                  active: draftEnabled,
                  disabled: locked,
                  onChange: (visibility) => options.onVisibilityChange?.(visibility),
                })
              : nothing
          }${renderSelectionStatus({
            toolOverrides: options.toolOverrides,
            disabled: locked,
            requestUpdate: options.requestUpdate,
          })}`,
      rootToggles: [
        ...(options.draftAvailable
          ? [
              {
                value: "new-session-draft",
                label: t("newSession.draft"),
                icon: icons.pencil,
                checked: draftEnabled,
                disabled: locked,
                title: t("newSession.draftDescription"),
                onChange: (checked: boolean) =>
                  options.onVisibilityChange?.(checked ? "draft" : "normal"),
              },
            ]
          : []),
        ...(options.onMemorylessChange
          ? [
              {
                value: "new-session-memoryless",
                label: t("newSession.memoryless"),
                icon: icons.brain,
                checked: options.memoryless === true,
                disabled: locked || options.visibility === "incognito",
                title: t("newSession.memorylessDescription"),
                onChange: options.onMemorylessChange,
              },
            ]
          : []),
      ],
      voiceControl: options.voiceControl,
      dictation: {
        active: dictationActive,
        preview: options.dictationPreview,
        status: options.dictationStatus,
      },
      placeholder: t(
        isCatalogTarget ? "newSession.nativeTerminalPrompt" : "newSession.messagePlaceholder",
      ),
      nativeTerminal: isCatalogTarget,
      submitting,
      messageLocked,
      requiresModifier: options.requiresModifier,
      start: {
        canSubmit: options.canSubmit,
        disabledReason: options.submitDisabledReason,
        label: submitting
          ? t("newSession.starting")
          : t(isCatalogTarget ? "newSession.startInTerminal" : "newSession.start"),
        onSubmit: options.onSubmit,
        onBackgroundSubmit: options.onBackgroundSubmit,
      },
      commandOwner: {
        client: commandClient,
        agentId: options.agentId,
        draftOwnerKey: options.draftOwnerKey,
      },
      onUnsupportedAttachment: options.onUnsupportedAttachment,
    },
  };
  return renderChatComposer(props);
}

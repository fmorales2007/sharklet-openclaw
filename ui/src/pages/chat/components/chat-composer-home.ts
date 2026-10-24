// Home-only composer behavior: starting a session instead of sending into one.
import { html } from "lit";
import { icons } from "../../../components/icons.ts";
import "../../../components/tooltip.ts";
import { t } from "../../../i18n/index.ts";
import { resetSkillMenuState } from "./chat-composer-skill-menu.ts";
import { resetSlashMenuState } from "./chat-composer-slash-menu.ts";
import type { ChatComposerHomeSlot, ChatComposerState } from "./chat-composer-types.ts";

/** Closes every open menu, then starts the session. */
export function submitHome(state: ChatComposerState, home: ChatComposerHomeSlot): void {
  state.mentionMenu.close();
  resetSkillMenuState(state);
  resetSlashMenuState(state);
  home.start.onSubmit();
}

/** The controller survives route, agent, and Gateway changes: drop a prior owner's pending menu. */
export function syncHomeCommandOwner(
  state: ChatComposerState,
  owner: ChatComposerHomeSlot["commandOwner"],
): void {
  const agentId = owner.agentId.trim();
  const current = state.commandOwner;
  if (
    current &&
    current.client === owner.client &&
    current.agentId === agentId &&
    current.draftOwnerKey === owner.draftOwnerKey
  ) {
    return;
  }
  state.commandOwner = { client: owner.client, agentId, draftOwnerKey: owner.draftOwnerKey };
  resetSkillMenuState(state);
}

export function ownsHomeCommands(
  state: ChatComposerState,
  client: object,
  agentId: string,
  draftOwnerKey: string,
): boolean {
  const owner = state.commandOwner;
  return (
    owner !== null &&
    owner.client === client &&
    owner.agentId === agentId.trim() &&
    owner.draftOwnerKey === draftOwnerKey
  );
}

export function homeKeyShortcuts(home: ChatComposerHomeSlot): string {
  const ordinary = home.requiresModifier ? "Control+Enter Meta+Enter" : "Enter";
  const background = home.requiresModifier
    ? "Control+Shift+Enter Meta+Shift+Enter"
    : "Control+Enter Meta+Enter";
  return home.start.onBackgroundSubmit ? `${ordinary} ${background}` : ordinary;
}

/** Enter after the menus declined it. Returns nothing: the caller has no history or queue to try. */
export function handleHomeEnter(
  event: KeyboardEvent,
  state: ChatComposerState,
  home: ChatComposerHomeSlot,
): void {
  if (event.key !== "Enter") {
    return;
  }
  const { start } = home;
  const hasSubmitModifier = event.metaKey || event.ctrlKey;
  const isBackgroundShortcut = home.requiresModifier
    ? hasSubmitModifier && event.shiftKey
    : hasSubmitModifier && !event.shiftKey;
  if (!event.altKey && isBackgroundShortcut && start.onBackgroundSubmit) {
    if (start.canSubmit || start.disabledReason !== undefined) {
      event.preventDefault();
      state.mentionMenu.close();
      resetSkillMenuState(state);
      resetSlashMenuState(state);
      start.onBackgroundSubmit();
    }
    return;
  }
  if (event.shiftKey || (home.requiresModifier && !hasSubmitModifier)) {
    return;
  }
  // A reasoned gate still consumes the press: the submission flow records the
  // attempt and surfaces the reason instead of silently inserting a newline.
  // Only silent gates (busy button, empty draft) keep Enter native.
  if (start.canSubmit || start.disabledReason !== undefined) {
    event.preventDefault();
    submitHome(state, home);
  }
}

export function renderHomeStartControl(state: ChatComposerState, home: ChatComposerHomeSlot) {
  const { start } = home;
  const reasonedBlock = !start.canSubmit && start.disabledReason !== undefined;
  return html` <openclaw-tooltip content=${start.disabledReason ?? start.label}>
    <button
      type="button"
      class="chat-send-btn new-session-page__start-submit ${
        reasonedBlock ? "new-session-page__start-submit--blocked" : ""
      }"
      ?disabled=${!start.canSubmit && !reasonedBlock}
      aria-disabled=${String(!start.canSubmit)}
      aria-busy=${String(home.submitting)}
      aria-label=${start.label}
      @click=${() => submitHome(state, home)}
    >
      ${home.submitting ? icons.loader : home.nativeTerminal ? icons.squareTerminal : icons.arrowUp}
    </button>
  </openclaw-tooltip>`;
}

export function homeReadingAttachmentNotice() {
  return html`<span class="sr-only" role="status">${t("newSession.readingAttachment")}</span>`;
}

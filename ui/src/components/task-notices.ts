import { html, nothing } from "lit";
import { t } from "../i18n/index.ts";
import { taskNotices, type TaskNotice } from "../lib/task-notices.ts";
import { OpenClawLightDomContentsElement } from "../lit/openclaw-element.ts";
import { icons } from "./icons.ts";

/** Subscribes the element to the notice store for as long as it is connected. */
abstract class TaskNoticeElement extends OpenClawLightDomContentsElement {
  private unsubscribe: (() => void) | null = null;

  override connectedCallback() {
    super.connectedCallback();
    this.unsubscribe = taskNotices.subscribe(() => this.requestUpdate());
  }

  override disconnectedCallback() {
    super.disconnectedCallback();
    this.unsubscribe?.();
    this.unsubscribe = null;
  }
}

function noticeIcon(notice: TaskNotice) {
  return notice.tone === "done" ? icons.check : icons.circleX;
}

class TaskNoticeStack extends TaskNoticeElement {
  override render() {
    const { visible } = taskNotices.snapshot;
    return html`<div class="task-notices" role="status" aria-live="polite">
      ${visible.map(
        (notice) => html`<div class="task-notice task-notice--${notice.tone}" data-task-notice>
          <span class="task-notice__icon" aria-hidden="true">${noticeIcon(notice)}</span>
          <span class="task-notice__title">${notice.title}</span>
          <button
            type="button"
            class="app-toast__dismiss"
            aria-label=${t("common.dismiss")}
            @click=${() => taskNotices.dismiss(notice.id)}
          >
            ${icons.x}
          </button>
        </div>`,
      )}
    </div>`;
  }
}

class NoticeBell extends TaskNoticeElement {
  private readonly popoverId = `notice-history-${Math.random().toString(36).slice(2, 8)}`;

  /** Pins the top-layer popover beside the bell and counts what it shows as read. */
  private readonly onToggle = (event: Event) => {
    const popover = event.currentTarget as HTMLElement;
    if ((event as ToggleEvent).newState !== "open") {
      return;
    }
    const bell = this.querySelector<HTMLElement>(".notice-bell");
    const rect = bell?.getBoundingClientRect();
    if (rect) {
      popover.style.left = `${rect.left}px`;
      popover.style.bottom = `${window.innerHeight - rect.top + 8}px`;
    }
    taskNotices.markRead();
  };

  override render() {
    const { history, unread } = taskNotices.snapshot;
    return html`
      <button
        type="button"
        class="notice-bell btn--icon"
        popovertarget=${this.popoverId}
        aria-label=${t("taskNotices.bell")}
        title=${t("taskNotices.bell")}
      >
        ${icons.bell}
        ${
          unread > 0
            ? html`<span
                class="notice-bell__badge"
                aria-label=${t("taskNotices.unread", { count: String(unread) })}
                >${unread}</span
              >`
            : nothing
        }
      </button>
      <div id=${this.popoverId} class="notice-history" popover="auto" @toggle=${this.onToggle}>
        ${
          history.length === 0
            ? html`<p class="notice-history__empty">${t("taskNotices.empty")}</p>`
            : html`<ul>
                  ${history.map(
                    (notice) => html`<li data-notice-history class="task-notice--${notice.tone}">
                      <span aria-hidden="true">${noticeIcon(notice)}</span>
                      <span>${notice.title}</span>
                    </li>`,
                  )}
                </ul>
                <button
                  type="button"
                  class="btn btn--small"
                  @click=${() => taskNotices.clearHistory()}
                >
                  ${t("taskNotices.clear")}
                </button>`
        }
      </div>
    `;
  }
}

if (!customElements.get("openclaw-task-notices")) {
  customElements.define("openclaw-task-notices", TaskNoticeStack);
}
if (!customElements.get("openclaw-notice-bell")) {
  customElements.define("openclaw-notice-bell", NoticeBell);
}

declare global {
  interface HTMLElementTagNameMap {
    "openclaw-task-notices": TaskNoticeStack;
    "openclaw-notice-bell": NoticeBell;
  }
}

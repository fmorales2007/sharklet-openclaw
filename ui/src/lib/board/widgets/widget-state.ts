// The three generic states of docs/design-system/board.md, rendered once for
// every widget and page built on the RPC layer. Markup is the design
// system's `sk-state`; copy comes from i18n.
import { html, nothing, type TemplateResult } from "lit";
import type { RpcError, RpcLoading, RpcOff } from "../../../api/rpc.ts";
import { icons } from "../../../components/icons.ts";
import { t } from "../../../i18n/index.ts";

/** After this long the skeleton gains "Still loading" and a cancel. */
export const STILL_LOADING_MS = 10_000;

export function renderWidgetLoading(
  loading: RpcLoading,
  options: { name: string; now: number; onCancel: () => void },
): TemplateResult {
  const slow = options.now - loading.since >= STILL_LOADING_MS;
  return html`
    <div
      class="sk-state sk-state--loading"
      role="status"
      aria-label=${t("missionControl.state.loading", { name: options.name })}
    >
      <span class="sk-skeleton" style="height:28px"></span>
      <span class="sk-skeleton" style="height:12px;width:70%"></span>
      <span class="sk-skeleton" style="height:12px;width:52%"></span>
      ${
        slow
          ? html`<span class="sk-stale"
              >${t("missionControl.state.stillLoading")}
              <button
                type="button"
                class="sk-btn sk-btn--ghost sk-btn--sm"
                @click=${options.onCancel}
              >
                ${t("missionControl.state.cancel")}
              </button></span
            >`
          : nothing
      }
    </div>
  `;
}

/** `inline` is the shape under stale content: it never removes what is on screen. */
export function renderWidgetError(
  error: RpcError,
  options: { name: string; inline: boolean; onRetry: () => void },
): TemplateResult {
  const retry = error.retryable
    ? html`<button
        type="button"
        class="sk-btn sk-btn--secondary sk-btn--sm"
        @click=${options.onRetry}
      >
        ${icons.rotateCcw}${t("missionControl.state.retry")}
      </button>`
    : nothing;
  if (options.inline) {
    return html`<div class="sk-state sk-state--error sk-state--inline" role="status">
      ${icons.circleX}
      <p>${t("missionControl.state.refreshFailed")}</p>
      ${retry}
    </div>`;
  }
  return html`<div class="sk-state sk-state--error" role="status">
    ${icons.circleX}
    <b>${t("missionControl.state.errorTitle", { name: options.name })}</b>
    <p>${error.message}</p>
    ${retry}
    ${
      error.detail
        ? html`<details>
            <summary>${t("missionControl.state.details")}</summary>
            <code>${error.detail}</code>
          </details>`
        : nothing
    }
  </div>`;
}

/** Off is a decision, not a failure: neutral, no retry. */
export function renderWidgetOff(off: RpcOff): TemplateResult {
  return html`<div class="sk-state sk-state--off">
    ${icons.powerOff}
    <b
      >${
        off.reason === "disabled"
          ? t("missionControl.state.offDisabled")
          : t("missionControl.state.offUnavailable")
      }</b
    >
    <p>${off.message}</p>
  </div>`;
}

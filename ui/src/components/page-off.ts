// A whole page turned off (board.md "Off"): the widget's disabled panel at page size.
import { html, type TemplateResult } from "lit";
import { t } from "../i18n/index.ts";
import { icons } from "./icons.ts";

export function renderPageOff(options: {
  page: string;
  reason?: string;
  onGoHome: () => void;
}): TemplateResult {
  return html`
    <section class="page-off" role="status" data-test-id="page-off">
      <div class="board-widget__disabled-plugin">
        <span class="nav-item__icon" aria-hidden="true">${icons.powerOff}</span>
        <strong>${t("sharklet.pageOff.title", { page: options.page })}</strong>
        <span>${options.reason ?? t("sharklet.pageOff.detail")}</span>
        <button class="btn btn--small" type="button" @click=${options.onGoHome}>
          ${t("sharklet.pageOff.goHome")}
        </button>
      </div>
    </section>
  `;
}

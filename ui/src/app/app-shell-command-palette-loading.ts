import { html } from "lit";
import { t } from "../i18n/index.ts";

export function renderCommandPaletteLoading(onClose: () => void) {
  const label = t("palette.placeholder");
  return html`<openclaw-modal-dialog
    class="cmd-palette-overlay palette"
    label=${label}
    style="--openclaw-modal-width: min(640px, calc(100vw - 32px));"
    @modal-cancel=${onClose}
  >
    <div class="sk-pop sk-palette" role="status" aria-label=${t("common.loading")}>
      <div class="sk-palette-input"><input disabled placeholder=${label} /></div>
      <div class="sk-palette-list">
        <div class="sk-menu-head">${t("common.loading")}</div>
      </div>
    </div>
  </openclaw-modal-dialog>`;
}

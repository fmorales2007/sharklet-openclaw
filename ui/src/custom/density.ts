// Density: data-density on <html>, persisted per browser, switched from the
// profile menu beside the light/dark toggle (app-sidebar-agent-menu.ts draws it).
import { html } from "lit";
import { icons } from "../components/icons.ts";
import "../components/tooltip.ts";
import { t } from "../i18n/index.ts";
import { OpenClawLightDomContentsElement } from "../lit/openclaw-element.ts";
import { getSafeLocalStorage } from "../local-storage.ts";

const DENSITY_KEY = "sharklet.density";

function isCompact(): boolean {
  return document.documentElement.dataset.density === "compact";
}

function setDensity(compact: boolean, persist: boolean): void {
  if (compact) {
    document.documentElement.dataset.density = "compact";
  } else {
    delete document.documentElement.dataset.density;
  }
  if (!persist) {
    return;
  }
  try {
    const storage = getSafeLocalStorage();
    if (compact) {
      storage?.setItem(DENSITY_KEY, "compact");
    } else {
      storage?.removeItem(DENSITY_KEY);
    }
  } catch {
    // Blocked storage: the choice lasts until the page reloads.
  }
}

/** Applies the stored density at startup. */
export function restoreDensity(): void {
  let stored: string | null = null;
  try {
    stored = getSafeLocalStorage()?.getItem(DENSITY_KEY) ?? null;
  } catch {
    // Blocked storage: comfortable, the default.
  }
  setDensity(stored === "compact", false);
}

class SharkletDensityToggle extends OpenClawLightDomContentsElement {
  override render() {
    const compact = isCompact();
    const label = t("sharklet.density", {
      density: t(compact ? "sharklet.compact" : "sharklet.comfortable"),
    });
    return html`
      <openclaw-tooltip .content=${label}>
        <button
          type="button"
          class="density-toggle"
          aria-label=${label}
          @click=${() => {
            setDensity(!compact, true);
            this.requestUpdate();
          }}
        >
          ${compact ? icons.layoutCompact : icons.layoutComfortable}
        </button>
      </openclaw-tooltip>
    `;
  }
}

customElements.define("sharklet-density-toggle", SharkletDensityToggle);

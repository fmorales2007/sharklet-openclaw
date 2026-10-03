// Sharklet's shell over upstream's (phase 1 step 2), without editing it:
//   - language: English unless Spanish (or another) is picked explicitly;
//   - copy: the English strings where the product speaks as OpenClaw — the
//     setup agent becomes Help, About and approvals say Sharklet;
//   - the help button, bottom right on wide screens (narrower ones reach Help
//     through upstream's own panel — the Home button, then its Help tab — or
//     Settings → Help);
//   - density: data-density on <html>, persisted per browser and switched from
//     the profile menu, beside upstream's light/dark toggle.
//
// The copy is written into upstream's en map at startup, the way its own lazy
// locale fragments assign into it (i18n/locales/en.ts:6-12), instead of being
// edited into en.ts. That keeps the ten upstream test files that pin "Ask OpenClaw"
// passing untouched and keeps en.ts, which upstream changes every release, out
// of the monthly rebase. shell.test.ts fails if upstream renames a key we
// replace, which would otherwise silently fall back to upstream's text.

import { html, render, type LitElement } from "lit";
import { icons } from "../components/icons.ts";
import { CUSTODIAN_PANEL_TOGGLE_EVENT } from "../components/panel-toggle-contract.ts";
import { i18n, t } from "../i18n/index.ts";
import type { TranslationMap } from "../i18n/lib/types.ts";
import { en } from "../i18n/locales/en.ts";
import { getSafeLocalStorage } from "../local-storage.ts";

/** Upstream English replaced by Sharklet's, by dotted key. Keys must exist upstream. */
export const SHARKLET_COPY: Readonly<Record<string, string>> = {
  "nav.askOpenClaw": "Help",
  "tabs.custodian": "Help",
  "custodian.title": "Sharklet",
  "custodian.placeholder": "Ask for help…",
  "custodian.thinking": "Sharklet is thinking",
  "custodian.requestFailed": "Sharklet could not reply. Try again.",
  "custodian.sessionRestarted":
    "{error} Sharklet started a fresh session; earlier messages remain for context.",
  "custodian.unsupportedGateway": "Update the Gateway to continue setup with Sharklet.",
  "custodian.panel.title": "Help",
  "custodian.panel.toggle": "Toggle help",
  "custodian.panel.close": "Close help",
  "custodian.panel.resize": "Resize help",
  "custodian.panel.dockBottom": "Dock help at bottom",
  "custodian.panel.dockRight": "Dock help at right",
  "updates.triage.hostHint":
    "If Help is unavailable, run `openclaw triage` on the Gateway host to open a local coding agent for diagnosis and repair. Diagnose the cause before retrying.",
  "approvalPage.brandName": "Sharklet",
  "approvalPage.connectionErrorDescription":
    "Sharklet cannot confirm or record a decision while disconnected. Reconnect to check the current status.",
  "aboutPage.productName": "Sharklet",
  "aboutPage.waveHello": "Wave hello",
  // The links under it are OpenClaw's, and the license line stays as upstream
  // wrote it: Sharklet runs on OpenClaw, under its MIT license.
  "aboutPage.linksLabel": "OpenClaw community and resources",
  "lazyView.staleSubtitle":
    "Sharklet was updated in the background. Reload to get the latest panel.",
  "browser.navigationCheckFailed":
    "Sharklet couldn’t verify this tab’s address. Refresh to try again.",
};

export function applySharkletCopy(map: TranslationMap = en): void {
  for (const [path, value] of Object.entries(SHARKLET_COPY)) {
    const keys = path.split(".");
    const leaf = keys.pop()!;
    let scope: unknown = map;
    for (const key of keys) {
      scope = (scope as TranslationMap | undefined)?.[key];
    }
    if (scope && typeof scope === "object" && typeof (scope as TranslationMap)[leaf] === "string") {
      (scope as TranslationMap)[leaf] = value;
    }
  }
}

// The help button. It toggles the setup-and-repair agent's panel, the same
// event upstream's own Help controls send. theme/shell.css places it and hides
// it where it would cover something.
// ponytail: shown to every operator on a wide screen; one without admin scope
// gets a button the panel ignores. Hide it by the panel's custodianAvailable if
// read-only operators become real.
function mountHelpButton(): void {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "sk-help-btn";
  button.title = t("nav.askOpenClaw");
  button.setAttribute("aria-label", t("nav.askOpenClaw"));
  render(icons.circleQuestionMark, button);
  button.addEventListener("click", () => {
    window.dispatchEvent(new CustomEvent(CUSTODIAN_PANEL_TOGGLE_EVENT));
  });
  document.body.append(button);
}

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

function renderDensityToggle(host: LitElement) {
  const compact = isCompact();
  const label = t("sharklet.density", {
    density: t(compact ? "sharklet.compact" : "sharklet.comfortable"),
  });
  return html`
    <openclaw-tooltip .content=${label}>
      <button
        type="button"
        class="theme-mode-toggle"
        aria-label=${label}
        @click=${() => {
          setDensity(!compact, true);
          host.requestUpdate();
        }}
      >
        ${compact ? icons.layoutCompact : icons.layoutComfortable}
      </button>
    </openclaw-tooltip>
  `;
}

export function installSharkletShell(): void {
  // English as the "system" language. Once connected, upstream applies the
  // gateway's synced language preference and, with none set, falls back to the
  // browser's (app-shell-gateway.ts:122) — Spanish on an es-CL machine. Sharklet
  // is en-US with Spanish as an explicit choice, so "system" means English;
  // locale.ts covers the first paint, before the gateway answers.
  i18n.getSystemLocale = () => "en";
  applySharkletCopy();
  // Help is the setup agent now; upstream draws it as a lobster in the
  // collapsed top bar, the settings list, the chat rail and the palette.
  Object.assign(icons, { lobster: icons.circleQuestionMark });

  let stored: string | null = null;
  try {
    stored = getSafeLocalStorage()?.getItem(DENSITY_KEY) ?? null;
  } catch {
    // Blocked storage: comfortable, the default.
  }
  setDensity(stored === "compact", false);
  // The density switch sits beside upstream's light/dark toggle in the profile
  // menu (app-sidebar-agent-menu.ts:592). Wrapping that element's render adds
  // it there without touching the menu; if upstream renames the element, the
  // switch is simply not drawn.
  void customElements.whenDefined("openclaw-theme-mode-toggle").then((toggle) => {
    const upstreamRender = toggle.prototype.render as (this: LitElement) => unknown;
    toggle.prototype.render = function (this: LitElement) {
      return html`${upstreamRender.call(this)}${renderDensityToggle(this)}`;
    };
  });

  mountHelpButton();
}

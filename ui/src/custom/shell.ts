// Sharklet's shell over upstream's (phase 1 step 2):
//   - language: English unless Spanish (or another) is picked explicitly;
//   - the help button, bottom right on wide screens (narrower ones reach Help
//     through upstream's own panel — the Home button, then its Help tab — or
//     Settings → Help);
//   - density: restored at startup; its switch is in the profile menu
//     (custom/density.ts, drawn by app-sidebar-agent-menu.ts).

import { render } from "lit";
import { icons } from "../components/icons.ts";
import { CUSTODIAN_PANEL_TOGGLE_EVENT } from "../components/panel-toggle-contract.ts";
import { i18n, t } from "../i18n/index.ts";
import { restoreDensity } from "./density.ts";

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
  button.dataset.shell = "";
  button.title = t("nav.askOpenClaw");
  button.setAttribute("aria-label", t("nav.askOpenClaw"));
  render(icons.circleQuestionMark, button);
  button.addEventListener("click", () => {
    window.dispatchEvent(new CustomEvent(CUSTODIAN_PANEL_TOGGLE_EVENT));
  });
  document.body.append(button);
}

export function installSharkletShell(): void {
  // English as the "system" language. Once connected, upstream applies the
  // gateway's synced language preference and, with none set, falls back to the
  // browser's (app-shell-gateway.ts:122) — Spanish on an es-CL machine. Sharklet
  // is en-US with Spanish as an explicit choice, so "system" means English;
  // locale.ts covers the first paint, before the gateway answers.
  i18n.getSystemLocale = () => "en";
  restoreDensity();
  mountHelpButton();
}

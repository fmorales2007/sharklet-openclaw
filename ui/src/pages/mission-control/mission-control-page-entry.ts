import { html } from "lit";
import { MissionControlPage } from "./mission-control-page.ts";

if (!customElements.get("openclaw-mission-control-page")) {
  customElements.define("openclaw-mission-control-page", MissionControlPage);
}

export const render = (data: unknown) =>
  html`<openclaw-mission-control-page .data=${data}></openclaw-mission-control-page>`;

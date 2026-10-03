// The shell's page slot: Mission Control's compact bar above the page, and
// either board.md's "Off" panel or the router outlet as the page itself.
import { html, nothing } from "lit";
import type { ShellViewHost } from "./app-shell-view.ts";
import { gatewayPresentationScope } from "./gateway-presentation-scope.ts";
import { isOptionalElementDefined, MISSION_CONTROL_BAR_ELEMENT } from "./lazy-custom-element.ts";

export function renderShellPageSlot(
  host: ShellViewHost,
  runtime: NonNullable<ShellViewHost["runtime"]>,
  slot: {
    activeRoute: string;
    missionBar: boolean;
    blocked: boolean;
    gatewayConnected: boolean;
  },
) {
  const pageOff = host.pagesOff?.render(slot.activeRoute, () => host.navigate("chat"));
  if (slot.missionBar) {
    host.lazyCustomElements.preload(MISSION_CONTROL_BAR_ELEMENT, { reportError: true });
  }
  const bar =
    !pageOff && slot.missionBar && isOptionalElementDefined(MISSION_CONTROL_BAR_ELEMENT)
      ? html`<sharklet-mission-bar></sharklet-mission-bar>`
      : nothing;
  return html`${bar}${
    pageOff ??
    html`<openclaw-router-outlet
      ?inert=${slot.blocked}
      aria-disabled=${slot.blocked ? "true" : nothing}
      .router=${runtime.router}
      .retryContext=${host.context}
      .retentionScope=${gatewayPresentationScope(host.context.gateway)}
      .onNotFound=${() => host.recoverNotFoundRoute()}
      .notFoundRecoveryReady=${slot.gatewayConnected}
    ></openclaw-router-outlet>`
  }`;
}

// Mission Control's board widget. A core board widget kind (CORE_BOARD_WIDGET_ELEMENTS),
// not a plugin: it reads one RpcResource from the page-owned sources and draws
// the generic states of board.md around its own content. Working now, usage and
// Up next live in the instrument strip, not on the board.
import type { BoardGetParams } from "@openclaw/gateway-protocol";
import { html, type PropertyValues } from "lit";
import { property } from "lit/decorators.js";
import type { GatewayAgentRow } from "../../../api/types.ts";
import { t } from "../../../i18n/index.ts";
import { OpenClawLightDomElement } from "../../../lit/openclaw-element.ts";
import type { BoardWidget } from "../types.ts";
import { ResourceController } from "./resource-controller.ts";

const VISIBLE_ROWS = 3;

/** Stat is 4x2 and Card 4x3 (board.md): states shed parts by this lookup, not by height. */
function sizeClass(widget: BoardWidget | undefined): "stat" | "card" | "panel" {
  const rows = widget?.sizeH ?? 3;
  return rows <= 2 ? "stat" : rows <= 3 ? "card" : "panel";
}

class AgentsWidget extends OpenClawLightDomElement {
  @property({ attribute: false }) widget?: BoardWidget;
  @property({ attribute: false }) session?: BoardGetParams;
  @property({ type: Boolean }) active = true;

  private readonly agents = new ResourceController<readonly GatewayAgentRow[]>(
    this,
    (sources) => sources.agents,
  );

  override connectedCallback() {
    super.connectedCallback();
    this.classList.add("sk-mc-widget");
  }

  protected override willUpdate(changed: PropertyValues<this>) {
    if (changed.has("widget")) {
      this.dataset.size = sizeClass(this.widget);
    }
  }

  override render() {
    const name = t("missionControl.agents.title");
    return html`<div class="sk-widget__head"><b>${name}</b></div>
      ${this.agents.render(name, (data) =>
        data.length === 0
          ? html`<p class="sk-widget__sub">${t("missionControl.agents.empty")}</p>`
          : html`<ul class="sk-mc-rows">
              ${data
                .slice(0, VISIBLE_ROWS)
                .map(
                  (agent) =>
                    html`<li><span>${agent.identity?.name ?? agent.name ?? agent.id}</span></li>`,
                )}
            </ul>`,
      )}`;
  }
}

customElements.define("sharklet-agents-widget", AgentsWidget);

// Mission Control's four widgets. Core board widget kinds (CORE_BOARD_WIDGET_ELEMENTS),
// not plugins: each reads one RpcResource from the page-owned sources and
// draws the generic states of board.md around its own content.
import type { BoardGetParams } from "@openclaw/gateway-protocol";
import { html, nothing, type PropertyValues, type TemplateResult } from "lit";
import { property, state } from "lit/decorators.js";
import type { RpcResource, RpcSnapshot } from "../../../api/rpc.ts";
import type { GatewayAgentRow, GatewaySessionRow, CronJob } from "../../../api/types.ts";
import { icons } from "../../../components/icons.ts";
import { t } from "../../../i18n/index.ts";
import { OpenClawLightDomElement } from "../../../lit/openclaw-element.ts";
import { formatRelativeTimestamp } from "../../format.ts";
import type { MissionControlSources, MonthUsage } from "../../mission-control/sources.ts";
import type { BoardWidget } from "../types.ts";
import { getMissionControlSources } from "./mission-control-sources.ts";
import {
  renderWidgetError,
  renderWidgetLoading,
  renderWidgetOff,
  STILL_LOADING_MS,
} from "./widget-state.ts";

const VISIBLE_ROWS = 3;

/** Stat is 4x2 and Card 4x3 (board.md): states shed parts by this lookup, not by height. */
function sizeClass(widget: BoardWidget | undefined): "stat" | "card" | "panel" {
  const rows = widget?.sizeH ?? 3;
  return rows <= 2 ? "stat" : rows <= 3 ? "card" : "panel";
}

abstract class MissionControlWidget<T> extends OpenClawLightDomElement {
  @property({ attribute: false }) widget?: BoardWidget;
  @property({ attribute: false }) session?: BoardGetParams;
  @property({ type: Boolean }) active = true;

  @state() snapshot?: RpcSnapshot<T>;
  @state() now = Date.now();

  private resource?: RpcResource<T>;
  private unsubscribe?: () => void;
  private slowTimer?: ReturnType<typeof setTimeout>;

  protected abstract readonly heading: string;
  protected abstract select(sources: MissionControlSources): RpcResource<T>;
  protected abstract renderData(data: T): TemplateResult;

  override connectedCallback() {
    super.connectedCallback();
    this.classList.add("sk-mc-widget");
    const sources = getMissionControlSources();
    if (!sources) {
      return;
    }
    this.resource = this.select(sources);
    this.snapshot = this.resource.snapshot;
    this.unsubscribe = this.resource.subscribe((next) => {
      this.snapshot = next;
    });
  }

  override disconnectedCallback() {
    this.unsubscribe?.();
    this.unsubscribe = undefined;
    clearTimeout(this.slowTimer);
    super.disconnectedCallback();
  }

  protected override willUpdate(changed: PropertyValues<this>) {
    if (changed.has("widget")) {
      this.dataset.size = sizeClass(this.widget);
    }
    if (changed.has("snapshot")) {
      clearTimeout(this.slowTimer);
      if (this.snapshot?.state === "loading") {
        const wait = Math.max(0, this.snapshot.since + STILL_LOADING_MS - Date.now());
        this.slowTimer = setTimeout(() => (this.now = Date.now()), wait);
      }
    }
  }

  private body(snapshot: RpcSnapshot<T> | undefined): TemplateResult | typeof nothing {
    const refresh = () => this.resource?.refresh();
    if (!snapshot) {
      return nothing;
    }
    switch (snapshot.state) {
      case "loading":
        return renderWidgetLoading(snapshot, {
          name: this.heading,
          now: this.now,
          onCancel: () => this.resource?.cancel(),
        });
      case "off":
        return renderWidgetOff(snapshot);
      case "error": {
        const error = { name: this.heading, onRetry: refresh };
        return snapshot.last
          ? html`${this.renderData(snapshot.last.data)}${renderWidgetError(snapshot, { ...error, inline: true })}`
          : renderWidgetError(snapshot, { ...error, inline: false });
      }
      case "ready":
        return html`${this.renderData(snapshot.data)}${
          snapshot.stale
            ? html`<div class="sk-stale">
                ${icons.clock}${t("missionControl.state.stale", {
                  time: formatRelativeTimestamp(snapshot.fetchedAt),
                })}
              </div>`
            : nothing
        }`;
    }
  }

  override render() {
    return html`<div class="sk-widget__head"><b>${this.heading}</b></div>
      ${this.body(this.snapshot)}`;
  }
}

function rows(items: readonly TemplateResult[], empty: string): TemplateResult {
  return items.length === 0
    ? html`<p class="sk-widget__sub">${empty}</p>`
    : html`<ul class="sk-mc-rows">
        ${items.slice(0, VISIBLE_ROWS).map((item) => html`<li>${item}</li>`)}
      </ul>`;
}

class WorkingNowWidget extends MissionControlWidget<readonly GatewaySessionRow[]> {
  protected get heading() {
    return t("missionControl.workingNow.title");
  }
  protected select(sources: MissionControlSources) {
    return sources.workingNow;
  }
  protected renderData(data: readonly GatewaySessionRow[]) {
    return rows(
      data.map(
        (row) => html`<span>${row.label || row.key}</span
          ><small
            >${t(`missionControl.workingNow.status.${row.status === "queued" ? "queued" : "running"}`)}</small
          >`,
      ),
      t("missionControl.workingNow.empty"),
    );
  }
}

class UpNextWidget extends MissionControlWidget<readonly CronJob[]> {
  protected get heading() {
    return t("missionControl.upNext.title");
  }
  protected select(sources: MissionControlSources) {
    return sources.upNext;
  }
  protected renderData(data: readonly CronJob[]) {
    return rows(
      data.map(
        (job) => html`<span>${job.name}</span
          ><small>${formatRelativeTimestamp(job.state?.nextRunAtMs)}</small>`,
      ),
      t("missionControl.upNext.empty"),
    );
  }
}

const RING_SIZE = 40;
const RING_STROKE = 5;
const RING_RADIUS = (RING_SIZE - RING_STROKE) / 2;
const RING_LENGTH = 2 * Math.PI * RING_RADIUS;

function renderRing(usage: MonthUsage): TemplateResult {
  const budget = usage.budgetUsd;
  const ratio = budget && budget > 0 ? Math.min(usage.spentUsd / budget, 1) : 0;
  const level = ratio >= 0.9 ? "bad" : ratio >= 0.7 ? "warn" : undefined;
  const mid = RING_SIZE / 2;
  return html`<svg
    class="sk-ring"
    width=${RING_SIZE}
    height=${RING_SIZE}
    viewBox="0 0 ${RING_SIZE} ${RING_SIZE}"
    data-budget=${budget === null ? "none" : "set"}
    data-level=${level ?? nothing}
    aria-hidden="true"
  >
    <circle
      class="track"
      cx=${mid}
      cy=${mid}
      r=${RING_RADIUS}
      fill="none"
      stroke-width=${RING_STROKE}
    ></circle>
    <circle
      class="value"
      cx=${mid}
      cy=${mid}
      r=${RING_RADIUS}
      fill="none"
      stroke-width=${RING_STROKE}
      stroke-dasharray="${RING_LENGTH * ratio} ${RING_LENGTH}"
    ></circle>
  </svg>`;
}

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

class MonthUsageWidget extends MissionControlWidget<MonthUsage> {
  protected get heading() {
    return t("missionControl.monthUsage.title");
  }
  protected select(sources: MissionControlSources) {
    return sources.monthUsage;
  }
  protected renderData(data: MonthUsage) {
    const spent = usd.format(data.spentUsd);
    const budget = data.budgetUsd;
    return html`<div
      class="sk-mc-usage"
      role="img"
      aria-label=${
        budget === null
          ? t("missionControl.monthUsage.labelNoBudget", { spent })
          : t("missionControl.monthUsage.labelBudget", { spent, budget: usd.format(budget) })
      }
    >
      ${renderRing(data)}
      <div>
        <div class="sk-widget__figure">${spent}</div>
        <div class="sk-widget__sub">
          ${
            budget === null
              ? t("missionControl.monthUsage.noBudget")
              : t("missionControl.monthUsage.ofBudget", { budget: usd.format(budget) })
          }
        </div>
      </div>
    </div>`;
  }
}

class AgentsWidget extends MissionControlWidget<readonly GatewayAgentRow[]> {
  protected get heading() {
    return t("missionControl.agents.title");
  }
  protected select(sources: MissionControlSources) {
    return sources.agents;
  }
  protected renderData(data: readonly GatewayAgentRow[]) {
    return rows(
      data.map((agent) => html`<span>${agent.identity?.name ?? agent.name ?? agent.id}</span>`),
      t("missionControl.agents.empty"),
    );
  }
}

customElements.define("sharklet-working-now-widget", WorkingNowWidget);
customElements.define("sharklet-up-next-widget", UpNextWidget);
customElements.define("sharklet-month-usage-widget", MonthUsageWidget);
customElements.define("sharklet-agents-widget", AgentsWidget);

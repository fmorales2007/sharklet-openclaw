// The instrument strip (components.md, `sk-strip`): Working now, the usage ring
// and Up next, each reading one Mission Control resource and drawing its own
// loading, error and stale states, so one failing call never blanks the strip.
import { consume } from "@lit/context";
import { html, nothing, type TemplateResult } from "lit";
import { property, state } from "lit/decorators.js";
import type { CronJob, GatewayAgentRow, GatewaySessionRow } from "../../api/types.ts";
import { applicationContext, type ApplicationContext } from "../../app/context.ts";
import { icons } from "../../components/icons.ts";
import { navigateMarkdownSession } from "../../components/markdown-session-links.ts";
import { t } from "../../i18n/index.ts";
import { ResourceController } from "../../lib/board/widgets/resource-controller.ts";
import { formatRelativeTimestamp } from "../../lib/format.ts";
import type { MonthUsage } from "../../lib/mission-control/sources.ts";
import { parseAgentSessionKey } from "../../lib/sessions/session-key.ts";
import { OpenClawLightDomElement } from "../../lit/openclaw-element.ts";
import { renderUsageRing, usageRing } from "./usage-ring.ts";

const TILE_COLORS = ["teal", "violet", "plum", "indigo", "olive", "rose", "sand"] as const;
const INLINE_ITEMS = 3;
const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

function tileColor(agentId: string): string {
  let hash = 0;
  for (const char of agentId) {
    hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  }
  return TILE_COLORS[hash % TILE_COLORS.length] ?? "teal";
}

export class MissionControlStrip extends OpenClawLightDomElement {
  @consume({ context: applicationContext, subscribe: true })
  private context?: ApplicationContext;

  /** The one-row version in the header of the other pages: no list, Working now opens Home. */
  @property({ type: Boolean, reflect: true }) compact = false;

  @state() private open = false;

  private readonly working = new ResourceController<readonly GatewaySessionRow[]>(
    this,
    (sources) => sources.workingNow,
  );
  private readonly usage = new ResourceController<MonthUsage>(
    this,
    (sources) => sources.monthUsage,
  );
  private readonly upNext = new ResourceController<readonly CronJob[]>(
    this,
    (sources) => sources.upNext,
  );
  private readonly agents = new ResourceController<readonly GatewayAgentRow[]>(
    this,
    (sources) => sources.agents,
  );

  override connectedCallback() {
    super.connectedCallback();
    this.classList.add("sk-strip");
    this.setAttribute("role", "region");
    this.setAttribute("aria-label", t("missionControl.stripLabel"));
  }

  private agentFor(row: GatewaySessionRow): { id: string; name: string } {
    const id = row.agentId ?? parseAgentSessionKey(row.key)?.agentId ?? "";
    const agent = this.agents.data?.find((entry) => entry.id === id);
    return { id, name: agent?.identity?.name ?? agent?.name ?? id };
  }

  private renderTile(row: GatewaySessionRow): TemplateResult {
    const { id, name } = this.agentFor(row);
    return html`<span class="sk-tile sk-tile--xs" data-agent=${tileColor(id)} aria-hidden="true"
      >${(name || "?").slice(0, 1).toUpperCase()}</span
    >`;
  }

  private renderWorking(rows: readonly GatewaySessionRow[]): TemplateResult {
    const status = (row: GatewaySessionRow) =>
      t(`missionControl.workingNow.status.${row.status === "queued" ? "queued" : "running"}`);
    return html`<button
      type="button"
      class="sk-working"
      aria-expanded=${this.compact ? nothing : this.open && rows.length > 0 ? "true" : "false"}
      aria-controls=${this.compact ? nothing : "sk-strip-jobs"}
      ?disabled=${!this.compact && rows.length === 0}
      @click=${() => (this.compact ? this.context?.navigate("home") : (this.open = !this.open))}
    >
      <span class="sk-working-count">
        <span class="sk-live" aria-hidden="true"></span>
        ${
          rows.length === 0
            ? t("missionControl.workingNow.empty")
            : t("missionControl.workingNow.count", { count: String(rows.length) })
        }
      </span>
      <span class="sk-working-items">
        ${rows
          .slice(0, INLINE_ITEMS)
          .map(
            (row) => html`<span class="sk-working-item"
              >${this.renderTile(row)}<b>${this.agentFor(row).name || row.key}</b
              ><span class="sk-trunc">${status(row)}</span></span
            >`,
          )}
      </span>
      <span class="sk-working-chevron" aria-hidden="true">${icons.chevronDown}</span>
    </button>`;
  }

  private renderJobs(rows: readonly GatewaySessionRow[]): TemplateResult {
    return html`<div
      class="sk-working-list"
      id="sk-strip-jobs"
      data-open=${this.open && rows.length > 0 ? "true" : "false"}
    >
      <div>
        ${rows.map((row) => {
          const { id } = this.agentFor(row);
          const title = row.label || row.key;
          return html`<div class="sk-job">
            ${this.renderTile(row)}
            <span class="sk-job-task">${title}</span>
            <span class="sk-job-step"
              ><span class="sk-live" aria-hidden="true"></span
              ><span class="sk-trunc"
                >${t(
                  `missionControl.workingNow.status.${row.status === "queued" ? "queued" : "running"}`,
                )}</span
              ></span
            >
            <span class="sk-job-meta sk-num"
              >${t("missionControl.workingNow.updated", {
                time: formatRelativeTimestamp(row.updatedAt),
              })}</span
            >
            ${
              id
                ? html`<button
                    type="button"
                    class="sk-btn sk-btn--ghost sk-btn--sm"
                    aria-label=${t("missionControl.workingNow.openLabel", { name: title })}
                    @click=${() =>
                      this.context &&
                      navigateMarkdownSession(this.context, { sessionKey: row.key, agentId: id })}
                  >
                    ${t("missionControl.workingNow.open")}
                  </button>`
                : nothing
            }
          </div>`;
        })}
      </div>
    </div>`;
  }

  private renderUsage(data: MonthUsage): TemplateResult {
    const ring = usageRing(data);
    const spent = usd.format(data.spentUsd);
    const budget = data.budgetUsd;
    const percent =
      ring.mode === "spent" ? `${Math.round((data.spentUsd / (budget ?? 1)) * 100)}%` : "";
    const label =
      budget === null
        ? t("missionControl.monthUsage.labelNoBudget", { spent })
        : t("missionControl.monthUsage.labelBudget", { spent, budget: usd.format(budget) });
    return html`<button
        type="button"
        class="sk-usage-btn"
        popovertarget="sk-strip-usage"
        aria-label=${label}
      >
        ${renderUsageRing(ring)}
        <span class="sk-num"
          >${spent}
          <small
            >${
              budget === null
                ? t("missionControl.monthUsage.noBudget")
                : ring.mode === "spent"
                  ? t("missionControl.monthUsage.percentOfBudget", {
                      percent,
                      budget: usd.format(budget),
                    })
                  : t("missionControl.monthUsage.ofBudget", { budget: usd.format(budget) })
            }</small
          ></span
        >
      </button>
      <div popover id="sk-strip-usage" class="sk-pop sk-strip-usage">
        <b>${t("missionControl.monthUsage.title")}</b>
        <p class="sk-num">${spent}</p>
        ${
          budget === null
            ? html`<p>${t("missionControl.monthUsage.noBudget")}</p>
                <p>${t("missionControl.monthUsage.noBudgetNote")}</p>
                <button
                  type="button"
                  class="sk-btn sk-btn--secondary sk-btn--sm"
                  @click=${() => this.context?.navigate("usage")}
                >
                  ${t("missionControl.monthUsage.setBudget")}
                </button>`
            : html`<p>
                ${t("missionControl.monthUsage.ofBudget", { budget: usd.format(budget) })}
              </p>`
        }
      </div>`;
  }

  private renderUpNext(jobs: readonly CronJob[]): TemplateResult {
    const [next] = jobs;
    return html`<div class="sk-upnext">
      ${icons.calendarClock}
      <span
        >${
          next
            ? t("missionControl.upNext.line", {
                name: next.name,
                time: formatRelativeTimestamp(next.state?.nextRunAtMs),
              })
            : t("missionControl.upNext.empty")
        }</span
      >
      ${
        jobs.length > 1
          ? html`<button type="button" @click=${() => this.context?.navigate("cron")}>
              ${t("missionControl.upNext.more", { count: String(jobs.length - 1) })}
            </button>`
          : nothing
      }
    </div>`;
  }

  private renderCompact(): TemplateResult {
    return html`<div class="sk-strip-row">
      <div class="sk-strip-cell sk-strip-cell--working">
        ${this.working.render(t("missionControl.workingNow.title"), (rows) =>
          this.renderWorking(rows),
        )}
      </div>
      <div class="sk-strip-cell">
        ${this.usage.render(t("missionControl.monthUsage.title"), (data) => this.renderUsage(data))}
      </div>
      <div class="sk-strip-cell sk-strip-cell--upnext">
        ${this.upNext.render(t("missionControl.upNext.title"), (jobs) => this.renderUpNext(jobs))}
      </div>
    </div>`;
  }

  override render() {
    if (this.compact) {
      return this.renderCompact();
    }
    return html`<div class="sk-strip-row">
        <div class="sk-strip-cell sk-strip-cell--working">
          ${this.working.render(t("missionControl.workingNow.title"), (rows) =>
            this.renderWorking(rows),
          )}
        </div>
        <div class="sk-strip-cell">
          ${this.usage.render(t("missionControl.monthUsage.title"), (data) =>
            this.renderUsage(data),
          )}
        </div>
      </div>
      ${this.renderJobs(this.working.data ?? [])}
      ${this.upNext.render(t("missionControl.upNext.title"), (jobs) => this.renderUpNext(jobs))}`;
  }
}

customElements.define("sharklet-mission-strip", MissionControlStrip);

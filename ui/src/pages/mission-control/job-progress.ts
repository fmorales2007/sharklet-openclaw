// Working now: the current step of a session's durable progress card, read from the
// gateway's store so it matches the chat, survives reloads and follows other devices.
// Loaded on the first working row, outside the boot chunk.
import { consume } from "@lit/context";
import { html } from "lit";
import { property } from "lit/decorators.js";
import { applicationContext, type ApplicationContext } from "../../app/context.ts";
import { SessionProgressCardController } from "../../components/session-progress-card-controller.ts";
import { t } from "../../i18n/index.ts";
import { OpenClawLightDomContentsElement } from "../../lit/openclaw-element.ts";

export class JobProgress extends OpenClawLightDomContentsElement {
  @consume({ context: applicationContext, subscribe: true })
  private context?: ApplicationContext;

  @property({ attribute: "session-key" }) sessionKey = "";
  @property({ attribute: "agent-id" }) agentId = "";
  /** Shown until the session has a progress card. */
  @property() fallback = "";

  private readonly progress = new SessionProgressCardController(this, {
    gateway: () => this.context?.gateway,
    target: () =>
      this.sessionKey
        ? { sessionKey: this.sessionKey, ...(this.agentId ? { agentId: this.agentId } : {}) }
        : undefined,
  });

  override render() {
    const steps = this.progress.card?.steps;
    if (!steps?.length) {
      return html`${this.fallback}`;
    }
    const current =
      steps.find((entry) => entry.status === "in_progress") ??
      steps.find((entry) => entry.status === "pending") ??
      steps.at(-1)!;
    return html`<span data-job-step
      >${t("missionControl.workingNow.step", {
        step: current.step,
        done: String(steps.filter((entry) => entry.status === "completed").length),
        total: String(steps.length),
      })}</span
    >`;
  }
}

customElements.define("sharklet-job-progress", JobProgress);

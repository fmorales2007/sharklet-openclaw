import { consume } from "@lit/context";
import { state } from "lit/decorators.js";
import type { AgentsListResult } from "../../api/types.ts";
import { applicationContext, type ApplicationContext } from "../../app/context.ts";
import { hasOperatorWriteAccess } from "../../app/operator-access.ts";
import { t } from "../../i18n/index.ts";
import { registerYouEnglish } from "../../i18n/locales/en-you.ts";
import { readYou, saveYouSection, type YouSaveFailure } from "../../lib/you/agent-files.ts";
import { saveYouDefaults, selectComposerDefaults } from "../../lib/you/defaults.ts";
import {
  draftFromSnapshot,
  draftProblems,
  planIsEmpty,
  planSave,
  type YouDraft,
} from "../../lib/you/draft.ts";
import type { SkillRule } from "../../lib/you/files.ts";
import { OpenClawLightDomElement } from "../../lit/openclaw-element.ts";
import "../../styles/settings-controls.css";
import "../../styles/settings.css";
import "../../styles/you.css";
import { renderYou, type YouViewProps } from "./view.ts";

registerYouEnglish();

const EMPTY_DRAFT: YouDraft = {
  aboutYou: "",
  responseStyle: { tone: "direct", length: "balanced", notes: "" },
  rules: [],
  memory: "",
  model: "",
  effort: "",
};

function failureLine(agent: string, failure: YouSaveFailure): string {
  switch (failure.kind) {
    case "changed":
      return t("youPage.failed.changed", { agent });
    case "invalid":
      return t("youPage.failed.invalid", { agent });
    default:
      return t("youPage.failed.rpc", { agent, reason: failure.error.message });
  }
}

class YouPage extends OpenClawLightDomElement {
  @consume({ context: applicationContext, subscribe: false })
  private context!: ApplicationContext;

  @state() private agents: AgentsListResult | null = null;
  @state() private agentId = "";
  @state() private targets: ReadonlySet<string> = new Set();
  @state() private base: YouDraft = EMPTY_DRAFT;
  @state() private draft: YouDraft = EMPTY_DRAFT;
  @state() private loading = true;
  @state() private loadError: string | null = null;
  @state() private saving = false;
  @state() private status: YouViewProps["status"] = null;

  private client: ApplicationContext["gateway"]["snapshot"]["client"] = null;
  private canWrite = false;
  private generation = 0;
  private unsubscribe: Array<() => void> = [];

  override connectedCallback() {
    super.connectedCallback();
    this.unsubscribe = [
      this.context.gateway.subscribe((snapshot) => this.onGateway(snapshot)),
      this.context.agents.subscribe(() => this.onAgents()),
    ];
    this.onGateway(this.context.gateway.snapshot);
  }

  override disconnectedCallback() {
    for (const off of this.unsubscribe) {
      off();
    }
    this.unsubscribe = [];
    this.generation += 1;
    super.disconnectedCallback();
  }

  private onGateway(snapshot: ApplicationContext["gateway"]["snapshot"]) {
    const connected = snapshot.phase === "connected" && snapshot.client !== null;
    const changed = snapshot.client !== this.client;
    this.client = connected ? snapshot.client : null;
    this.canWrite = connected && hasOperatorWriteAccess(snapshot.hello?.auth ?? null);
    if (connected && changed) {
      void this.context.agents.ensureList().then(() => this.onAgents());
    }
  }

  private onAgents() {
    const list = this.context.agents.state.agentsList;
    if (!list) {
      return;
    }
    const first = this.agents === null;
    this.agents = list;
    if (first || !list.agents.some((agent) => agent.id === this.agentId)) {
      this.selectAgent(
        list.agents.some((a) => a.id === this.agentId) ? this.agentId : list.defaultId,
      );
    }
  }

  private selectAgent(agentId: string) {
    this.agentId = agentId;
    this.targets = new Set([agentId]);
    void this.load();
  }

  private async load() {
    const client = this.client;
    const list = this.agents;
    if (!client || !list || !this.agentId) {
      return;
    }
    const mine = ++this.generation;
    this.loading = true;
    this.loadError = null;
    this.status = null;
    const result = await readYou(client, this.agentId);
    if (mine !== this.generation) {
      return;
    }
    this.loading = false;
    if (!result.ok) {
      this.loadError = t("youPage.loadFailed", { agent: this.agentLabel(this.agentId) });
      return;
    }
    const defaults = selectComposerDefaults(list, null, this.agentId);
    this.base = draftFromSnapshot(result.value, defaults);
    this.draft = { ...this.base, rules: this.base.rules.map((rule) => ({ ...rule })) };
  }

  private agentLabel(id: string) {
    return this.agents?.agents.find((a) => a.id === id)?.name ?? id;
  }

  private async save() {
    const client = this.client;
    const plan = planSave(this.base, this.draft);
    if (!client || !this.canWrite || this.saving || planIsEmpty(plan)) {
      return;
    }
    const agentIds = [...this.targets];
    this.saving = true;
    this.status = null;
    const failures: string[] = [];
    let saved = 0;
    for (const change of plan.changes) {
      for (const outcome of await saveYouSection(client, agentIds, change)) {
        if (outcome.result.ok) {
          saved += 1;
        } else {
          failures.push(failureLine(this.agentLabel(outcome.agentId), outcome.result.error));
        }
      }
    }
    if (plan.defaults) {
      for (const agentId of agentIds) {
        const result = await saveYouDefaults(client, { agentId, ...plan.defaults });
        if (result.ok) {
          saved += 1;
        } else {
          failures.push(
            t("youPage.failed.rpc", {
              agent: this.agentLabel(agentId),
              reason: result.error.message,
            }),
          );
        }
      }
    }
    this.saving = false;
    this.status =
      failures.length > 0
        ? { kind: "error", lines: failures }
        : {
            kind: "saved",
            lines: [
              agentIds.length > 1
                ? t("youPage.saved.many", { count: String(agentIds.length) })
                : t("youPage.saved.one", { agent: this.agentLabel(agentIds[0] ?? this.agentId) }),
            ],
          };
    if (saved > 0) {
      // What the files hold now is the new baseline; a refused agent keeps its draft visible.
      await this.reloadKeepingStatus();
    }
  }

  private async reloadKeepingStatus() {
    const status = this.status;
    await this.load();
    if (!this.loadError) {
      this.status = status;
    }
  }

  override render() {
    const list = this.agents;
    const props: YouViewProps = {
      agents: list?.agents.map((agent) => ({ id: agent.id, name: agent.name ?? agent.id })) ?? [],
      agentId: this.agentId,
      targets: this.targets,
      draft: this.draft,
      loading: this.loading,
      loadError: this.loadError,
      dirty: !planIsEmpty(planSave(this.base, this.draft)) && this.canWrite,
      saving: this.saving,
      problems: draftProblems(this.draft, t),
      status: this.status,
      onAgent: (agentId) => this.selectAgent(agentId),
      onTarget: (agentId, on) => {
        const next = new Set(this.targets);
        if (on) {
          next.add(agentId);
        } else {
          next.delete(agentId);
        }
        this.targets = next;
      },
      onDraft: (patch) => {
        this.draft = { ...this.draft, ...patch };
        this.status = null;
      },
      onRuleChange: (index, patch) => {
        this.draft = {
          ...this.draft,
          rules: this.draft.rules.map((rule, i) => (i === index ? { ...rule, ...patch } : rule)),
        };
        this.status = null;
      },
      onRuleAdd: () => {
        const blank: SkillRule = { when: "", skill: "" };
        this.draft = { ...this.draft, rules: [...this.draft.rules, blank] };
      },
      onRuleRemove: (index) => {
        this.draft = { ...this.draft, rules: this.draft.rules.filter((_, i) => i !== index) };
      },
      onSave: () => void this.save(),
      onRetry: () => void this.load(),
    };
    if (Object.keys(props.problems).length > 0) {
      props.dirty = false;
    }
    return renderYou(props);
  }
}

if (!customElements.get("openclaw-you-page")) {
  customElements.define("openclaw-you-page", YouPage);
}

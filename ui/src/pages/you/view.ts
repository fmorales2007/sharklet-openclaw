// You page view (F2-07). Pure: props in, template out. One primary button for the
// whole screen (Save changes); every section is a plain form block with its label
// above and its help below (design-system components.md, Fields).
import { html, nothing, type TemplateResult } from "lit";
import type { PersonalContextSwitches } from "../../api/rpc.ts";
import {
  renderSettingsPage,
  renderSettingsRow,
  renderSettingsSection,
  renderSettingsSegmented,
  renderSettingsToggleRow,
} from "../../components/settings-ui.ts";
import { t } from "../../i18n/index.ts";
import type { YouDraft } from "../../lib/you/draft.ts";
import { SKILL_RULES_MAX, type SkillRule } from "../../lib/you/files.ts";
import type { FileUsage } from "../../lib/you/limits.ts";
import type { YouUsage } from "../../lib/you/usage.ts";

export const YOU_ABOUT_MAX = 1200;
export const YOU_NOTES_MAX = 400;
export const YOU_MEMORY_MAX = 6000;
export const YOU_EFFORT_LEVELS = ["off", "minimal", "low", "medium", "high"] as const;

export type YouViewProps = {
  agents: ReadonlyArray<{ id: string; name: string }>;
  agentId: string;
  /** Agents the save writes into; always includes `agentId`. */
  targets: ReadonlySet<string>;
  draft: YouDraft;
  loading: boolean;
  loadError: string | null;
  dirty: boolean;
  saving: boolean;
  /** Per-section problems the draft cannot be saved with, by section id. */
  problems: Readonly<Record<string, string>>;
  status: { kind: "saved" | "error"; lines: string[] } | null;
  /** Sizes of the files with the form as it stands; null until the gateway has answered. */
  usage: YouUsage | null;
  /** Which pieces this agent reads; null until the gateway has answered. */
  switches: PersonalContextSwitches | null;
  canWrite: boolean;
  onSwitch: (piece: keyof PersonalContextSwitches, on: boolean) => void;
  onAgent: (agentId: string) => void;
  onTarget: (agentId: string, on: boolean) => void;
  onDraft: (patch: Partial<YouDraft>) => void;
  onRuleChange: (index: number, patch: Partial<SkillRule>) => void;
  onRuleAdd: () => void;
  onRuleRemove: (index: number) => void;
  onSave: () => void;
  onRetry: () => void;
};

function field(opts: {
  id: string;
  label: string;
  help?: unknown;
  error?: string;
  control: TemplateResult;
}) {
  return html`<div class="you-field">
    <label class="you-field__label" for=${opts.id}>${opts.label}</label>
    ${opts.control}
    ${
      opts.error
        ? html`<p class="you-field__error" id="${opts.id}-error" role="alert">${opts.error}</p>`
        : opts.help
          ? html`<p class="you-field__help" id="${opts.id}-help">${opts.help}</p>`
          : nothing
    }
  </div>`;
}

function counter(used: number, max: number) {
  return t("youPage.count", { used: String(used), max: String(max) });
}

function textarea(opts: {
  id: string;
  value: string;
  max: number;
  rows: number;
  placeholder: string;
  disabled: boolean;
  invalid: boolean;
  onInput: (value: string) => void;
}) {
  return html`<textarea
    id=${opts.id}
    class="settings-input you-textarea"
    rows=${opts.rows}
    maxlength=${opts.max}
    placeholder=${opts.placeholder}
    aria-invalid=${opts.invalid ? "true" : "false"}
    ?disabled=${opts.disabled}
    .value=${opts.value}
    @input=${(event: Event) => opts.onInput((event.target as HTMLTextAreaElement).value)}
  ></textarea>`;
}

function renderRules(props: YouViewProps, busy: boolean) {
  const { rules } = props.draft;
  return html`
    ${
      rules.length === 0
        ? html`<p class="you-empty">${t("youPage.rules.empty")}</p>`
        : html`<ul class="you-rules">
            ${rules.map(
              (rule, index) => html`<li class="you-rule">
                <span class="you-rule__lead" aria-hidden="true">${t("youPage.rules.when")}</span>
                <input
                  class="settings-input you-rule__when"
                  type="text"
                  inputmode="text"
                  maxlength="120"
                  placeholder=${t("youPage.rules.whenPlaceholder")}
                  aria-label=${t("youPage.rules.whenLabel", { n: String(index + 1) })}
                  ?disabled=${busy}
                  .value=${rule.when}
                  @input=${(event: Event) =>
                    props.onRuleChange(index, { when: (event.target as HTMLInputElement).value })}
                />
                <span class="you-rule__lead" aria-hidden="true">${t("youPage.rules.use")}</span>
                <input
                  class="settings-input you-rule__skill"
                  type="text"
                  inputmode="text"
                  autocapitalize="none"
                  spellcheck="false"
                  maxlength="64"
                  placeholder=${t("youPage.rules.skillPlaceholder")}
                  aria-label=${t("youPage.rules.skillLabel", { n: String(index + 1) })}
                  ?disabled=${busy}
                  .value=${rule.skill}
                  @input=${(event: Event) =>
                    props.onRuleChange(index, { skill: (event.target as HTMLInputElement).value })}
                />
                <button
                  type="button"
                  class="btn btn--sm"
                  aria-label=${t("youPage.rules.remove", { n: String(index + 1) })}
                  ?disabled=${busy}
                  @click=${() => props.onRuleRemove(index)}
                >
                  ${t("youPage.rules.removeShort")}
                </button>
              </li>`,
            )}
          </ul>`
    }
    ${props.problems.rules ? html`<p class="you-field__error" role="alert">${props.problems.rules}</p>` : nothing}
    <button
      type="button"
      class="btn btn--sm you-add"
      ?disabled=${busy || rules.length >= SKILL_RULES_MAX}
      @click=${() => props.onRuleAdd()}
    >
      ${t("youPage.rules.add")}
    </button>
  `;
}

const PIECES = ["aboutYou", "responseStyle", "skillRules", "memory"] as const;

function meter(label: string, usage: FileUsage, warning: string | null) {
  const state = usage.over ? "over" : usage.near ? "near" : "ok";
  const percent = Math.min(100, Math.round(usage.ratio * 100));
  return renderSettingsRow({
    title: label,
    description: warning
      ? html`<span class="you-meter__warning" role="status">${warning}</span>`
      : undefined,
    stacked: true,
    control: html`<div class="you-meter" data-state=${state}>
      <div
        class="you-meter__bar"
        role="meter"
        aria-label=${label}
        aria-valuemin="0"
        aria-valuemax=${String(usage.limit)}
        aria-valuenow=${String(usage.chars)}
      >
        <div class="you-meter__fill" style=${`width:${percent}%`}></div>
      </div>
      <span class="you-meter__text"
        >${t("youPage.context.size.used", {
          used: usage.chars.toLocaleString(),
          max: usage.limit.toLocaleString(),
        })}</span
      >
    </div>`,
  });
}

function renderContext(props: YouViewProps, busy: boolean) {
  const { usage, switches } = props;
  if (!usage || !switches) {
    return nothing;
  }
  const file = (key: "user" | "agents" | "memory" | "total") =>
    t(`youPage.context.size.files.${key}`);
  const near = (key: "user" | "agents", u: FileUsage) =>
    u.over
      ? t("youPage.context.size.over", { file: file(key) })
      : u.near
        ? t("youPage.context.size.near", { file: file(key) })
        : null;
  return html`
    ${renderSettingsSection(
      { title: t("youPage.context.title"), description: t("youPage.context.description") },
      PIECES.map((piece) =>
        renderSettingsToggleRow({
          title: t(`youPage.context.pieces.${piece}.title`),
          description: t(`youPage.context.pieces.${piece}.description`),
          checked: switches[piece],
          disabled: busy || !props.canWrite,
          onChange: (on) => props.onSwitch(piece, on),
        }),
      ),
    )}
    ${renderSettingsSection(
      {
        title: t("youPage.context.size.title"),
        description: t("youPage.context.size.description"),
      },
      html`
        ${meter(file("user"), usage.user, near("user", usage.user))}
        ${meter(file("agents"), usage.agents, near("agents", usage.agents))}
        ${meter(
          file("memory"),
          usage.memory,
          usage.memory.over ? t("youPage.context.size.memoryOver") : null,
        )}
        ${meter(
          file("total"),
          usage.total,
          usage.total.over ? t("youPage.context.size.totalOver") : null,
        )}
      `,
    )}
  `;
}

export function renderYou(props: YouViewProps) {
  const busy = props.loading || props.saving;
  const d = props.draft;
  const others = props.agents.filter((agent) => agent.id !== props.agentId);
  return html`
    <section class="content-header content-header--settings">
      <div>
        <div class="page-title">${t("tabs.you")}</div>
        <div class="page-subtitle">${t("subtitles.you")}</div>
      </div>
      <button
        type="button"
        class="btn primary"
        data-test-id="you-save"
        aria-busy=${props.saving ? "true" : "false"}
        ?disabled=${!props.dirty || busy}
        @click=${() => props.onSave()}
      >
        ${props.saving ? t("youPage.saving") : t("youPage.save")}
      </button>
    </section>
    ${renderSettingsPage(html`
      ${
        props.status
          ? html`<div
              class="you-status you-status--${props.status.kind}"
              role=${props.status.kind === "error" ? "alert" : "status"}
            >
              ${props.status.lines.map((line) => html`<p>${line}</p>`)}
            </div>`
          : nothing
      }
      ${renderSettingsSection(
        { title: t("youPage.scope.title"), description: t("youPage.scope.description") },
        html`
          ${renderSettingsRow({
            title: t("youPage.scope.agent"),
            description: t("youPage.scope.agentHint"),
            control: html`<select
              class="settings-input you-select"
              data-test-id="you-agent"
              aria-label=${t("youPage.scope.agent")}
              ?disabled=${busy}
              .value=${props.agentId}
              @change=${(event: Event) => props.onAgent((event.target as HTMLSelectElement).value)}
            >
              ${props.agents.map(
                (agent) =>
                  html`<option value=${agent.id} ?selected=${agent.id === props.agentId}>
                    ${agent.name}
                  </option>`,
              )}
            </select>`,
          })}
          ${
            others.length > 0
              ? renderSettingsRow({
                  title: t("youPage.scope.also"),
                  description: t("youPage.scope.alsoHint"),
                  stacked: true,
                  control: html`<div
                    class="you-targets"
                    role="group"
                    aria-label=${t("youPage.scope.also")}
                  >
                    ${others.map(
                      (agent) => html`<label class="you-target">
                        <input
                          type="checkbox"
                          ?checked=${props.targets.has(agent.id)}
                          ?disabled=${busy}
                          @change=${(event: Event) =>
                            props.onTarget(agent.id, (event.target as HTMLInputElement).checked)}
                        />
                        <span>${agent.name}</span>
                      </label>`,
                    )}
                  </div>`,
                })
              : nothing
          }
        `,
      )}
      ${renderContext(props, busy)}
      ${
        props.loadError
          ? html`<div class="you-status you-status--error" role="alert">
              <p>${props.loadError}</p>
              <button type="button" class="btn btn--sm" @click=${() => props.onRetry()}>
                ${t("youPage.retry")}
              </button>
            </div>`
          : nothing
      }
      ${renderSettingsSection(
        { title: t("youPage.about.title"), description: t("youPage.about.description") },
        field({
          id: "you-about",
          label: t("youPage.about.label"),
          help: counter(d.aboutYou.length, YOU_ABOUT_MAX),
          error: props.problems.about,
          control: textarea({
            id: "you-about",
            value: d.aboutYou,
            max: YOU_ABOUT_MAX,
            rows: 4,
            placeholder: t("youPage.about.placeholder"),
            disabled: busy,
            invalid: Boolean(props.problems.about),
            onInput: (aboutYou) => props.onDraft({ aboutYou }),
          }),
        }),
      )}
      ${renderSettingsSection(
        { title: t("youPage.style.title"), description: t("youPage.style.description") },
        html`
          ${renderSettingsRow({
            title: t("youPage.style.tone"),
            control: renderSettingsSegmented({
              value: d.responseStyle.tone,
              ariaLabel: t("youPage.style.tone"),
              disabled: busy,
              options: (["direct", "warm", "formal"] as const).map((value) => ({
                value,
                label: t(`youPage.style.tones.${value}`),
                testId: `you-tone-${value}`,
              })),
              onChange: (tone) => props.onDraft({ responseStyle: { ...d.responseStyle, tone } }),
            }),
          })}
          ${renderSettingsRow({
            title: t("youPage.style.length"),
            control: renderSettingsSegmented({
              value: d.responseStyle.length,
              ariaLabel: t("youPage.style.length"),
              disabled: busy,
              options: (["brief", "balanced", "detailed"] as const).map((value) => ({
                value,
                label: t(`youPage.style.lengths.${value}`),
              })),
              onChange: (length) =>
                props.onDraft({ responseStyle: { ...d.responseStyle, length } }),
            }),
          })}
          ${field({
            id: "you-style-notes",
            label: t("youPage.style.notes"),
            help: counter(d.responseStyle.notes.length, YOU_NOTES_MAX),
            error: props.problems.style,
            control: textarea({
              id: "you-style-notes",
              value: d.responseStyle.notes,
              max: YOU_NOTES_MAX,
              rows: 2,
              placeholder: t("youPage.style.notesPlaceholder"),
              disabled: busy,
              invalid: Boolean(props.problems.style),
              onInput: (notes) => props.onDraft({ responseStyle: { ...d.responseStyle, notes } }),
            }),
          })}
        `,
      )}
      ${renderSettingsSection(
        { title: t("youPage.rules.title"), description: t("youPage.rules.description") },
        renderRules(props, busy),
      )}
      ${renderSettingsSection(
        { title: t("youPage.memory.title"), description: t("youPage.memory.description") },
        field({
          id: "you-memory",
          label: t("youPage.memory.label"),
          help: counter(d.memory.length, YOU_MEMORY_MAX),
          error: props.problems.memory,
          control: textarea({
            id: "you-memory",
            value: d.memory,
            max: YOU_MEMORY_MAX,
            rows: 5,
            placeholder: t("youPage.memory.placeholder"),
            disabled: busy,
            invalid: Boolean(props.problems.memory),
            onInput: (memory) => props.onDraft({ memory }),
          }),
        }),
      )}
      ${renderSettingsSection(
        { title: t("youPage.defaults.title"), description: t("youPage.defaults.description") },
        html`
          ${field({
            id: "you-model",
            label: t("youPage.defaults.model"),
            help: t("youPage.defaults.modelHint"),
            error: props.problems.model,
            control: html`<input
              id="you-model"
              class="settings-input"
              type="text"
              inputmode="text"
              autocapitalize="none"
              spellcheck="false"
              maxlength="256"
              placeholder=${t("youPage.defaults.modelPlaceholder")}
              ?disabled=${busy}
              .value=${d.model}
              @input=${(event: Event) =>
                props.onDraft({ model: (event.target as HTMLInputElement).value })}
            />`,
          })}
          ${field({
            id: "you-effort",
            label: t("youPage.defaults.effort"),
            help: t("youPage.defaults.effortHint"),
            control: html`<select
              id="you-effort"
              class="settings-input you-select"
              ?disabled=${busy}
              .value=${d.effort}
              @change=${(event: Event) =>
                props.onDraft({ effort: (event.target as HTMLSelectElement).value })}
            >
              <option value="" ?selected=${d.effort === ""}>
                ${t("youPage.defaults.effortInherit")}
              </option>
              ${YOU_EFFORT_LEVELS.map(
                (level) =>
                  html`<option value=${level} ?selected=${d.effort === level}>
                    ${t(`youPage.defaults.levels.${level}`)}
                  </option>`,
              )}
            </select>`,
          })}
        `,
      )}
    `)}
  `;
}

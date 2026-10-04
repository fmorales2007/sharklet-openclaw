import { html, nothing, type TemplateResult } from "lit";
import {
  TEXT_SCALE_STOPS,
  UI_APPEARANCE_DEFAULTS,
  type TextScaleStop,
} from "../../app/settings.ts";
import {
  renderSettingsDefaultDescription,
  renderSettingsRow,
  renderSettingsSegmented,
  renderSettingsStatus,
  renderSettingsValue,
} from "../../components/settings-ui.ts";
import { t } from "../../i18n/index.ts";
import { APPEARANCE_SETTINGS_TARGET_IDS } from "./route-data.ts";
import {
  renderChatPreferencesSection,
  renderLanguageSection,
  renderLobsterPetSection,
  serverUiPrefProvenanceHint,
  renderSidebarPreferencesSection,
} from "./view-appearance-preferences.ts";
import type { ConfigProps } from "./view-types.ts";

const TEXT_SCALE_LABELS: Record<TextScaleStop, string> = {
  90: "configView.textSizes.small",
  100: "configView.textSizes.default",
  110: "configView.textSizes.large",
  125: "configView.textSizes.xl",
  140: "configView.textSizes.xxl",
};

export function renderAppearanceSection(
  props: ConfigProps,
  inputs: { chatMessageWidth: TemplateResult },
) {
  const themeModeDefault =
    props.themeModeResetValue === "light"
      ? t("common.light")
      : props.themeModeResetValue === "dark"
        ? t("common.dark")
        : t("common.system");
  const themeModeProvenance = serverUiPrefProvenanceHint(props.themeModeProvenance);
  return html`
    <div class="settings-page">
      ${renderLanguageSection(props)}
      <section id=${APPEARANCE_SETTINGS_TARGET_IDS.theme} class="settings-section">
        <div class="settings-section__header">
          <h2 class="settings-section__heading">${t("configView.appearance.theme")}</h2>
        </div>
        <div class="settings-group">
          ${renderSettingsRow({
            title: t("common.colorMode"),
            description: html`${renderSettingsDefaultDescription(
              themeModeDefault,
              props.themeModeOverridden,
            )}
            ${themeModeProvenance}`,
            stackedOnNarrow: true,
            control: renderSettingsSegmented({
              value: props.themeMode,
              options: [
                { value: "system", label: t("common.system") },
                { value: "light", label: t("common.light") },
                { value: "dark", label: t("common.dark") },
              ],
              ariaLabel: t("common.colorMode"),
              onChange: (mode, element) => props.setThemeMode(mode, { element }),
              onReselect: (mode, element) => {
                if (props.themeModeOverridden && mode === props.themeModeResetValue) {
                  props.setThemeMode(mode, { element });
                }
              },
            }),
          })}
        </div>
      </section>

      <section id=${APPEARANCE_SETTINGS_TARGET_IDS.textSize} class="settings-section">
        <div class="settings-section__header">
          <h2 class="settings-section__heading">${t("configView.appearance.textSize")}</h2>
        </div>
        <p class="settings-section__desc">
          ${renderSettingsDefaultDescription(
            `${UI_APPEARANCE_DEFAULTS.textScale}%`,
            props.textScaleOverridden,
          )}
          ${t("quickSettings.personal.browserOnly")}
        </p>
        <div class="settings-group">
          <div class="settings-row settings-row--stacked">
            <div class="settings-text-scale">
              <div class="settings-text-scale__options">
                ${TEXT_SCALE_STOPS.map(
                  (stop) => html`
                    <button
                      type="button"
                      class="settings-text-scale__btn ${stop === props.textScale ? "active" : ""}"
                      aria-pressed=${String(stop === props.textScale)}
                      @click=${() => props.setTextScale(stop)}
                    >
                      <span class="settings-text-scale__sample">${t(TEXT_SCALE_LABELS[stop])}</span>
                      <span class="settings-text-scale__label">${stop}%</span>
                    </button>
                  `,
                )}
              </div>
            </div>
          </div>
        </div>
      </section>

      ${renderSidebarPreferencesSection(props)} ${renderLobsterPetSection(props)}
      ${renderChatPreferencesSection(props, inputs.chatMessageWidth)}

      <section id=${APPEARANCE_SETTINGS_TARGET_IDS.connection} class="settings-section">
        <div class="settings-section__header">
          <h2 class="settings-section__heading">${t("configView.connection.title")}</h2>
        </div>
        <div class="settings-group">
          ${renderSettingsRow({
            title: t("configView.connection.gateway"),
            control: renderSettingsValue(props.gatewayUrl || "-", { mono: true }),
          })}
          ${renderSettingsRow({
            title: t("configView.connection.status"),
            control: renderSettingsStatus({
              kind: props.connected ? "ok" : "muted",
              label: props.connected ? t("common.connected") : t("common.offline"),
            }),
          })}
          ${
            props.assistantName
              ? renderSettingsRow({
                  title: t("configView.connection.assistant"),
                  control: renderSettingsValue(props.assistantName),
                })
              : nothing
          }
        </div>
      </section>
    </div>
  `;
}

import { html, nothing, type TemplateResult } from "lit";
import { subtitleForRoute, titleForRoute } from "../../app-navigation.ts";
import { renderPluginsHubTabs, type PluginsHubTab } from "./plugins-hub.ts";

type PluginsHubHeaderProps = {
  active: PluginsHubTab;
  onSelect: (tab: PluginsHubTab) => void;
  secondaryAction?: {
    label: string;
    icon?: TemplateResult;
    onClick: () => void;
  };
};

export function renderPluginsHubHeader(props: PluginsHubHeaderProps): TemplateResult {
  return html`
    <section
      class="content-header content-header--settings content-header--page hub-page-header plugins-hub-header"
    >
      <div class="hub-page-header__title">
        <h1 class="page-title">${titleForRoute(props.active)}</h1>
        <div class="page-subtitle">${subtitleForRoute(props.active)}</div>
      </div>
      <div class="hub-page-header__tabs">
        ${renderPluginsHubTabs({ active: props.active, onSelect: props.onSelect })}
      </div>
      <div class="hub-page-header__actions">
        ${
          props.secondaryAction
            ? html`<button
                type="button"
                class="btn btn--sm ${
                  props.secondaryAction.icon ? "btn--icon" : ""
                } plugins-hub-header__secondary oc-action oc-action-secondary"
                aria-label=${props.secondaryAction.label}
                title=${props.secondaryAction.icon ? props.secondaryAction.label : nothing}
                @click=${props.secondaryAction.onClick}
              >
                ${props.secondaryAction.icon ?? props.secondaryAction.label}
              </button>`
            : nothing
        }
      </div>
    </section>
  `;
}

import { consume } from "@lit/context";
import { html } from "lit";
import { property, state } from "lit/decorators.js";
import { keyed } from "lit/directives/keyed.js";
import { applicationContext, type ApplicationContext } from "../../app/context.ts";
import { t } from "../../i18n/index.ts";
import type { BoardOp, BoardSnapshot } from "../../lib/board/types.ts";
import type { BoardViewCallbacks } from "../../lib/board/view-types.ts";
import { OpenClawLightDomElement } from "../../lit/openclaw-element.ts";
import { ensureBoardViewElement } from "../chat/board-session-surface.ts";
import "../../custom/theme/components.css";
import "./mission-control-strip.ts";
import {
  applyLocalOps,
  defaultMissionControlSnapshot,
  MISSION_CONTROL_SESSION_KEY,
} from "./board-state.ts";
import "../new-session/new-session-page-entry.ts";
import { MissionControlSourcesController } from "./sources-controller.ts";

export class MissionControlPage extends OpenClawLightDomElement {
  @consume({ context: applicationContext, subscribe: true })
  private context?: ApplicationContext;

  @property({ attribute: false }) data?: unknown;

  @state() private snapshot: BoardSnapshot = defaultMissionControlSnapshot();
  @state() private boardReady = false;

  private readonly sourcesController = new MissionControlSourcesController(
    this,
    () => this.context?.gateway,
  );

  private readonly callbacks: BoardViewCallbacks = {
    applyOps: async (ops: BoardOp[]) => {
      this.snapshot = applyLocalOps(this.snapshot, ops);
    },
    grant: async () => undefined,
    selectTab: () => undefined,
  };

  override connectedCallback() {
    super.connectedCallback();
    void ensureBoardViewElement().then(() => {
      this.boardReady = true;
    });
  }

  override render() {
    return html`
      <div class="sk-mc">
        ${keyed(this.sourcesController.sources, html`<sharklet-mission-strip></sharklet-mission-strip>`)}
        <section class="sk-mc__board" aria-label=${t("missionControl.boardLabel")}>
          ${
            this.boardReady
              ? keyed(
                  this.sourcesController.sources,
                  html`<openclaw-board-view
                    .active=${true}
                    .session=${{ sessionKey: MISSION_CONTROL_SESSION_KEY }}
                    .snapshot=${this.snapshot}
                    .activeTabId=${this.snapshot.tabs[0]?.tabId ?? ""}
                    .widgetFrameUrl=${() => ""}
                    .callbacks=${this.callbacks}
                    .canMutate=${true}
                    .canGrant=${false}
                  ></openclaw-board-view>`,
                )
              : null
          }
        </section>
        <section class="sk-mc__composer" aria-label=${t("missionControl.composerLabel")}>
          <openclaw-new-session-page
            .data=${this.data}
            .composerOnly=${true}
          ></openclaw-new-session-page>
        </section>
      </div>
    `;
  }
}

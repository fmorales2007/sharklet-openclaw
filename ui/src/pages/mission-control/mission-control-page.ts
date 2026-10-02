import { consume } from "@lit/context";
import { html, type PropertyValues } from "lit";
import { property, state } from "lit/decorators.js";
import { keyed } from "lit/directives/keyed.js";
import type { RpcClient, RpcOff } from "../../api/rpc.ts";
import { applicationContext, type ApplicationContext } from "../../app/context.ts";
import { t } from "../../i18n/index.ts";
import type { BoardOp, BoardSnapshot } from "../../lib/board/types.ts";
import type { BoardViewCallbacks } from "../../lib/board/view-types.ts";
import {
  setMissionControlSources,
  staticResource,
} from "../../lib/board/widgets/mission-control-sources.ts";
import {
  createMissionControlSources,
  type MissionControlSources,
} from "../../lib/mission-control/sources.ts";
import { OpenClawLightDomElement } from "../../lit/openclaw-element.ts";
import { ensureBoardViewElement } from "../chat/board-session-surface.ts";
import "../../custom/theme/components.css";
import "../new-session/new-session-page-entry.ts";
import {
  applyLocalOps,
  defaultMissionControlSnapshot,
  MISSION_CONTROL_SESSION_KEY,
} from "./board-state.ts";

/** Until the RPC layer ships (F1-06) the gateway cannot serve these: say so, per widget. */
function unavailableSources(): MissionControlSources {
  const off = (method: RpcOff["method"]) =>
    staticResource<never>({
      state: "off",
      reason: "unavailable",
      method,
      message: t("missionControl.state.unavailableMessage"),
    });
  return {
    workingNow: off("sessions.list"),
    upNext: off("cron.list"),
    monthUsage: off("usage.cost"),
    agents: off("agents.list"),
  };
}

function loadingSources(): MissionControlSources {
  const loading = () => staticResource<never>({ state: "loading", since: Date.now() });
  return { workingNow: loading(), upNext: loading(), monthUsage: loading(), agents: loading() };
}

function sourcesFor(client: RpcClient | null): MissionControlSources {
  if (!client) {
    return loadingSources();
  }
  try {
    return createMissionControlSources(client);
  } catch {
    return unavailableSources();
  }
}

export class MissionControlPage extends OpenClawLightDomElement {
  @consume({ context: applicationContext, subscribe: true })
  private context?: ApplicationContext;

  @property({ attribute: false }) data?: unknown;

  @state() private snapshot: BoardSnapshot = defaultMissionControlSnapshot();
  @state() private sources?: MissionControlSources;
  @state() private boardReady = false;

  private client: RpcClient | null | undefined;

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

  override disconnectedCallback() {
    this.release();
    super.disconnectedCallback();
  }

  private release() {
    setMissionControlSources(null);
    for (const resource of Object.values(this.sources ?? {})) {
      resource.dispose();
    }
    this.sources = undefined;
  }

  protected override willUpdate(_changed: PropertyValues<this>) {
    const client = this.context?.gateway.snapshot.client ?? null;
    if (this.client !== client) {
      this.client = client;
      this.release();
      this.sources = sourcesFor(client);
      setMissionControlSources(this.sources);
    }
  }

  override render() {
    return html`
      <div class="sk-mc">
        <section class="sk-mc__board" aria-label=${t("missionControl.boardLabel")}>
          ${
            this.boardReady
              ? keyed(
                  this.sources,
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
          <openclaw-new-session-page .data=${this.data}></openclaw-new-session-page>
        </section>
      </div>
    `;
  }
}

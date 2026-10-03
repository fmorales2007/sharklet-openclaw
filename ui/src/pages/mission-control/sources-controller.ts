// Owns the Mission Control sources for whoever draws them: the page, and the
// compact bar in the other pages' header. Only one of the two is mounted at a
// time, so the module-level slot the widgets read stays single-owner.
import type { ReactiveController, ReactiveControllerHost } from "lit";
import type { RpcClient, RpcOff } from "../../api/rpc.ts";
import { t } from "../../i18n/index.ts";
import {
  getMissionControlSources,
  setMissionControlSources,
  staticResource,
} from "../../lib/board/widgets/mission-control-sources.ts";
import {
  createMissionControlSources,
  type MissionControlSources,
} from "../../lib/mission-control/sources.ts";

/** Until the gateway can serve these: say so, per widget. */
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

export class MissionControlSourcesController implements ReactiveController {
  sources?: MissionControlSources;
  private client: RpcClient | null | undefined;

  constructor(
    host: ReactiveControllerHost,
    private readonly getClient: () => RpcClient | null,
  ) {
    host.addController(this);
  }

  hostUpdate() {
    const client = this.getClient();
    if (this.client !== client) {
      this.client = client;
      this.release();
      this.sources = sourcesFor(client);
      setMissionControlSources(this.sources);
    }
  }

  hostDisconnected() {
    this.release();
    this.client = undefined;
  }

  private release() {
    // The page and the bar swap on navigation; only clear the slot if it is still ours.
    if (this.sources && getMissionControlSources() === this.sources) {
      setMissionControlSources(null);
    }
    for (const resource of Object.values(this.sources ?? {})) {
      resource.dispose();
    }
    this.sources = undefined;
  }
}

// Owns the Mission Control sources for whoever draws them: the page, and the
// compact bar in the other pages' header. Only one of the two is mounted at a
// time, so the module-level slot the widgets read stays single-owner.
import type { ReactiveController, ReactiveControllerHost } from "lit";
import type { RpcClient } from "../../api/rpc.ts";
import type { ApplicationGateway } from "../../app/gateway.ts";
import {
  getMissionControlSources,
  setMissionControlSources,
  staticResource,
} from "../../lib/board/widgets/mission-control-sources.ts";
import {
  createMissionControlSources,
  type MissionControlSources,
} from "../../lib/mission-control/sources.ts";

/** Usage and cron have no change event: what is on screen is refreshed this often. */
const REFRESH_MS = 60_000;

function loadingSources(): MissionControlSources {
  const loading = () => staticResource<never>({ state: "loading", since: Date.now() });
  return { workingNow: loading(), upNext: loading(), monthUsage: loading(), agents: loading() };
}

export class MissionControlSourcesController implements ReactiveController {
  sources?: MissionControlSources;
  private client: RpcClient | null | undefined;
  private gateway?: ApplicationGateway;
  private unfollow?: () => void;

  constructor(
    private readonly host: ReactiveControllerHost,
    private readonly getGateway: () => ApplicationGateway | undefined,
  ) {
    host.addController(this);
  }

  hostUpdate() {
    const gateway = this.getGateway();
    if (gateway !== this.gateway) {
      this.follow(gateway);
    }
    // Only a connected client: one still connecting fails every first call, and
    // a reconnect replaces the client while the app context stays the same.
    const snapshot = gateway?.snapshot;
    const client = snapshot?.phase === "connected" ? snapshot.client : null;
    if (this.client !== client) {
      this.client = client;
      this.release();
      this.sources = client ? createMissionControlSources(client) : loadingSources();
      setMissionControlSources(this.sources);
    }
  }

  hostDisconnected() {
    this.follow(undefined);
    this.release();
    this.client = undefined;
  }

  private follow(gateway: ApplicationGateway | undefined) {
    this.unfollow?.();
    this.unfollow = undefined;
    this.gateway = gateway;
    if (!gateway) {
      return;
    }
    const offGateway = gateway.subscribe(() => this.host.requestUpdate());
    const offEvents = gateway.subscribeEvents((event) => {
      if (event.event === "sessions.changed") {
        this.sources?.workingNow.refresh({ quiet: true });
      }
    });
    const timer = setInterval(() => {
      if (document.visibilityState !== "visible") {
        return;
      }
      for (const resource of Object.values(this.sources ?? {})) {
        resource.refresh({ quiet: true });
      }
    }, REFRESH_MS);
    this.unfollow = () => {
      offGateway();
      offEvents();
      clearInterval(timer);
    };
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

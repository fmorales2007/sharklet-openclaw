// Page kill switch, client side. The gateway owns it (`ui.pages.off` in its
// config); this reads it through the RPC layer's `pages.state` and refreshes
// on `config.changed`, so turning a page off needs no redeploy or reload.
import { rpcResource, type RpcClient } from "../api/rpc.ts";
import type { ApplicationGateway } from "../app/gateway.ts";

/** The way back: these can never be shown as off, whatever the gateway says. */
const NEVER_OFF = new Set(["chat", "settings", "config", "connection"]);

export type PageOff = { reason?: string };

export class PagesOffStore {
  private off: ReadonlyMap<string, PageOff> = new Map();

  /** Off entry for a route id, or undefined when the page is on. */
  get(routeId: string): PageOff | undefined {
    return NEVER_OFF.has(routeId) ? undefined : this.off.get(routeId);
  }

  ids(): ReadonlySet<string> {
    return new Set(this.off.keys());
  }

  /** Follows one gateway; returns the cleanup. A failed refresh keeps the last known state. */
  connect(gateway: ApplicationGateway, notify: () => void): () => void {
    let client: RpcClient | null = null;
    let stop: (() => void) | undefined;
    const sync = () => {
      const { phase, client: next } = gateway.snapshot;
      const live = phase === "connected" && next ? next : null;
      if (live === client) {
        return;
      }
      stop?.();
      stop = undefined;
      client = live;
      if (!live) {
        return;
      }
      const resource = rpcResource(live, "pages.state", {}, (result) => result.off);
      const unsubscribe = resource.subscribe((snapshot) => {
        if (snapshot.state === "ready") {
          this.off = new Map(snapshot.data.map((entry) => [entry.id, { reason: entry.reason }]));
        } else if (snapshot.state === "off") {
          // The gateway has no switch: nothing is off.
          this.off = new Map();
        } else {
          return;
        }
        notify();
      });
      const unsubscribeEvents = gateway.subscribeEvents((event) => {
        if (event.event === "config.changed") {
          resource.refresh();
        }
      });
      stop = () => {
        unsubscribe();
        unsubscribeEvents();
        resource.dispose();
      };
    };
    const unsubscribeGateway = gateway.subscribe(sync);
    sync();
    return () => {
      unsubscribeGateway();
      stop?.();
    };
  }
}

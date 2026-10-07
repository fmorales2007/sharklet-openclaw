// Page kill switch, client side. The gateway owns it (`ui.pages.off` in its
// config); this reads it through the RPC layer's `pages.state` and refreshes
// on `config.changed`, so turning a page off needs no redeploy or reload.
import { html, type TemplateResult } from "lit";
import type { RpcClient } from "../api/rpc.ts";
import { titleForRoute } from "../app-navigation.ts";
import type { RouteId } from "../app-route-paths.ts";
import type { ApplicationGateway } from "../app/gateway.ts";
import { icons } from "../components/icons.ts";
import { t } from "../i18n/index.ts";

/** The way back: these can never be shown as off, whatever the gateway says. */
const NEVER_OFF = new Set(["chat", "settings", "config", "connection"]);

export type PageOff = { reason?: string };

export class PagesOffStore {
  private off: ReadonlyMap<string, PageOff> = new Map();
  private offIds: ReadonlySet<string> = new Set();

  /** Off entry for a route id, or undefined when the page is on. */
  get(routeId: string): PageOff | undefined {
    return NEVER_OFF.has(routeId) ? undefined : this.off.get(routeId);
  }

  /** board.md "Off" at page size: the widget's disabled panel, for a page that is off. */
  render(routeId: RouteId, onGoToChat: () => void): TemplateResult | undefined {
    const off = this.get(routeId);
    return off
      ? html`
          <section class="page-off" role="status" data-test-id="page-off">
            <div class="board-widget__disabled-plugin">
              <span class="nav-item__icon" aria-hidden="true">${icons.powerOff}</span>
              <strong>${t("sharklet.pageOff.title", { page: titleForRoute(routeId) })}</strong>
              <span>${off.reason ?? t("sharklet.pageOff.detail")}</span>
              <button class="btn btn--small" type="button" @click=${onGoToChat}>
                ${t("sharklet.pageOff.goToChat")}
              </button>
            </div>
          </section>
        `
      : undefined;
  }

  /** Route ids shown as off (Ctrl K's badge), by the same rule as `get`; stable between changes. */
  ids(): ReadonlySet<string> {
    return this.offIds;
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
      // The RPC layer carries the protocol schemas: keep it out of the boot chunk.
      void import("../api/rpc.ts").then(({ rpcResource }) => {
        if (client !== live) {
          return;
        }
        follow(live, rpcResource);
      });
    };
    const follow = (live: RpcClient, rpcResource: typeof import("../api/rpc.ts").rpcResource) => {
      const resource = rpcResource(live, "pages.state", {}, (result) => result.off);
      const unsubscribe = resource.subscribe((snapshot) => {
        if (snapshot.state !== "ready") {
          return;
        }
        this.off = new Map(snapshot.data.map((entry) => [entry.id, { reason: entry.reason }]));
        this.offIds = new Set([...this.off.keys()].filter((id) => !NEVER_OFF.has(id)));
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
      client = null;
      stop?.();
    };
  }
}

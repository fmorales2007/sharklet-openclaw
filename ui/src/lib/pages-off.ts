// Page kill switch, client side. The gateway owns it (`ui.pages.off` in its
// config); this reads it through the RPC layer's `pages.state` and refreshes
// on `config.changed`, so turning a page off needs no redeploy or reload.
import { html, svg, type TemplateResult } from "lit";
import type { RpcClient } from "../api/rpc.ts";
import { titleForRoute } from "../app-navigation.ts";
import type { RouteId } from "../app-route-paths.ts";
import type { ApplicationGateway } from "../app/gateway.ts";
import { strokeIcon } from "../components/icons-tools.ts";
import { t } from "../i18n/index.ts";

/** The way back: these can never be shown as off, whatever the gateway says. */
const NEVER_OFF = new Set(["chat", "settings", "config", "connection"]);

const powerOffIcon = strokeIcon(
  svg` <path d="M12 2v10" /> <path d="M18.4 6.6a9 9 0 1 1-12.77.04" />`,
);

export type PageOff = { reason?: string };

export class PagesOffStore {
  private off: ReadonlyMap<string, PageOff> = new Map();

  /** Off entry for a route id, or undefined when the page is on. */
  get(routeId: string): PageOff | undefined {
    return NEVER_OFF.has(routeId) ? undefined : this.off.get(routeId);
  }

  /** board.md "Off" at page size: the widget's disabled panel, for a page that is off. */
  render(routeId: RouteId, onGoHome: () => void): TemplateResult | undefined {
    const off = this.get(routeId);
    return off
      ? html`
          <section class="page-off" role="status" data-test-id="page-off">
            <div class="board-widget__disabled-plugin">
              <span class="nav-item__icon" aria-hidden="true">${powerOffIcon}</span>
              <strong>${t("sharklet.pageOff.title", { page: titleForRoute(routeId) })}</strong>
              <span>${off.reason ?? t("sharklet.pageOff.detail")}</span>
              <button class="btn btn--small" type="button" @click=${onGoHome}>
                ${t("sharklet.pageOff.goHome")}
              </button>
            </div>
          </section>
        `
      : undefined;
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
      client = null;
      stop?.();
    };
  }
}

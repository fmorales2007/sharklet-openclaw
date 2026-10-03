// One subscription to a Mission Control RpcResource and the board.md states
// around its data. Shared by the board widget and the instrument strip, so
// both draw loading, error (with a per-resource Try again) and stale alike.
import {
  html,
  nothing,
  type ReactiveController,
  type ReactiveControllerHost,
  type TemplateResult,
} from "lit";
import type { RpcResource, RpcSnapshot } from "../../../api/rpc.ts";
import { icons } from "../../../components/icons.ts";
import { t } from "../../../i18n/index.ts";
import { formatRelativeTimestamp } from "../../format.ts";
import type { MissionControlSources } from "../../mission-control/sources.ts";
import { getMissionControlSources } from "./mission-control-sources.ts";
import {
  renderWidgetError,
  renderWidgetLoading,
  renderWidgetOff,
  STILL_LOADING_MS,
} from "./widget-state.ts";

export class ResourceController<T> implements ReactiveController {
  snapshot?: RpcSnapshot<T>;
  private now = Date.now();
  private resource?: RpcResource<T>;
  private unsubscribe?: () => void;
  private slowTimer?: ReturnType<typeof setTimeout>;

  constructor(
    private readonly host: ReactiveControllerHost,
    private readonly select: (sources: MissionControlSources) => RpcResource<T>,
  ) {
    host.addController(this);
  }

  hostConnected() {
    const sources = getMissionControlSources();
    if (!sources) {
      return;
    }
    this.resource = this.select(sources);
    this.set(this.resource.snapshot);
    this.unsubscribe = this.resource.subscribe((next) => this.set(next));
  }

  hostDisconnected() {
    this.unsubscribe?.();
    this.unsubscribe = undefined;
    clearTimeout(this.slowTimer);
  }

  private set(next: RpcSnapshot<T>) {
    this.snapshot = next;
    clearTimeout(this.slowTimer);
    if (next.state === "loading") {
      const wait = Math.max(0, next.since + STILL_LOADING_MS - Date.now());
      this.slowTimer = setTimeout(() => {
        this.now = Date.now();
        this.host.requestUpdate();
      }, wait);
    }
    this.host.requestUpdate();
  }

  /** The data of a ready snapshot, or the last data kept under an error. */
  get data(): T | undefined {
    const snapshot = this.snapshot;
    if (snapshot?.state === "ready") {
      return snapshot.data;
    }
    return snapshot?.state === "error" ? snapshot.last?.data : undefined;
  }

  /** Render `renderData` inside the generic states for `name`. */
  render(name: string, renderData: (data: T) => TemplateResult): TemplateResult | typeof nothing {
    const snapshot = this.snapshot;
    if (!snapshot) {
      return nothing;
    }
    const retry = () => this.resource?.refresh();
    switch (snapshot.state) {
      case "loading":
        return renderWidgetLoading(snapshot, {
          name,
          now: this.now,
          onCancel: () => this.resource?.cancel(),
        });
      case "off":
        return renderWidgetOff(snapshot);
      case "error":
        return snapshot.last
          ? html`${renderData(snapshot.last.data)}${renderWidgetError(snapshot, {
              name,
              onRetry: retry,
              inline: true,
            })}`
          : renderWidgetError(snapshot, { name, onRetry: retry, inline: false });
      case "ready":
        return html`${renderData(snapshot.data)}${
          snapshot.stale
            ? html`<div class="sk-stale">
                ${icons.clock}${t("missionControl.state.stale", {
                  time: formatRelativeTimestamp(snapshot.fetchedAt),
                })}
              </div>`
            : nothing
        }`;
    }
    return nothing;
  }
}

// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RpcResource, RpcSnapshot } from "../../../api/rpc.ts";
import type { MissionControlSources, MonthUsage } from "../../mission-control/sources.ts";
import { getPluginWidgetKindContribution } from "./index.ts";
import "./mission-control.ts";
import { setMissionControlSources, staticResource } from "./mission-control-sources.ts";

const usage: MonthUsage = {
  spentUsd: 6.42,
  startDate: "2026-10-01",
  endDate: "2026-10-15",
  updatedAt: 1,
  budgetUsd: null,
};

function sources(monthUsage: RpcResource<MonthUsage>): MissionControlSources {
  const idle = staticResource<never>({ state: "loading", since: Date.now() });
  return { workingNow: idle, upNext: idle, agents: idle, monthUsage };
}

async function mount(tag: string, size = 3) {
  const element = document.createElement(tag) as HTMLElement & {
    widget?: unknown;
    updateComplete: Promise<boolean>;
  };
  element.widget = { sizeW: 4, sizeH: size };
  document.body.append(element);
  await element.updateComplete;
  return element;
}

const ready = (data: MonthUsage): RpcSnapshot<MonthUsage> => ({
  state: "ready",
  data,
  fetchedAt: Date.now(),
  stale: false,
});

afterEach(() => {
  document.body.replaceChildren();
  setMissionControlSources(null);
});

describe("mission control widgets", () => {
  it("registers Sharklet kinds without the gateway advertising them", () => {
    expect(getPluginWidgetKindContribution("sharklet:month-usage", [])?.tagName).toBe(
      "sharklet-month-usage-widget",
    );
    expect(getPluginWidgetKindContribution("other:month-usage", [])).toBeNull();
  });

  it("shows the real spend and no made-up ring when there is no budget", async () => {
    setMissionControlSources(sources(staticResource(ready(usage))));
    const el = await mount("sharklet-month-usage-widget");
    expect(el.querySelector(".sk-widget__head b")?.textContent).toBe("Spent this month");
    expect(el.textContent).toContain("$6.42");
    expect(el.textContent).toContain("No budget set");
    expect(el.querySelector(".sk-ring")?.getAttribute("data-budget")).toBe("none");
    expect(el.querySelector("[role=img]")?.getAttribute("aria-label")).toBe(
      "Spent $6.42 this month. No budget set.",
    );
  });

  it("loads with a skeleton, never text inside it", async () => {
    setMissionControlSources(sources(staticResource({ state: "loading", since: Date.now() })));
    const el = await mount("sharklet-month-usage-widget");
    const state = el.querySelector(".sk-state--loading");
    expect(state?.getAttribute("aria-label")).toBe("Loading Spent this month");
    expect(state?.querySelectorAll(".sk-skeleton").length).toBeGreaterThan(0);
    expect(state?.textContent?.trim()).toBe("");
  });

  it("errors inside the widget and retries only that widget", async () => {
    const refresh = vi.fn();
    const error: RpcSnapshot<MonthUsage> = {
      state: "error",
      kind: "unreachable",
      method: "usage.cost",
      message: "Couldn’t reach the gateway. Check that it is running, then try again.",
      detail: "ECONNREFUSED",
      retryable: true,
    };
    setMissionControlSources(sources(staticResource(error, refresh)));
    const el = await mount("sharklet-month-usage-widget");
    expect(el.querySelector(".sk-state--error")?.getAttribute("role")).toBe("status");
    expect(el.querySelector("details code")?.textContent).toBe("ECONNREFUSED");
    el.querySelector<HTMLButtonElement>(".sk-state--error button")?.click();
    expect(refresh).toHaveBeenCalledOnce();
  });

  it("keeps the last figures under an inline error", async () => {
    const error: RpcSnapshot<MonthUsage> = {
      state: "error",
      kind: "timeout",
      method: "usage.cost",
      message: "Timed out.",
      retryable: true,
      last: { data: usage, fetchedAt: Date.now() },
    };
    setMissionControlSources(sources(staticResource(error)));
    const el = await mount("sharklet-month-usage-widget");
    expect(el.textContent).toContain("$6.42");
    expect(el.querySelector(".sk-state--inline")).not.toBeNull();
  });

  it("is neutral when off, with no retry", async () => {
    setMissionControlSources(
      sources(
        staticResource({
          state: "off",
          reason: "disabled",
          method: "usage.cost",
          message: "Off while it is being fixed.",
        }),
      ),
    );
    const el = await mount("sharklet-month-usage-widget");
    expect(el.querySelector(".sk-state--off b")?.textContent).toBe("Turned off");
    expect(el.querySelector("button")).toBeNull();
  });

  it("marks the size so states can shed parts", async () => {
    setMissionControlSources(sources(staticResource(ready(usage))));
    expect((await mount("sharklet-month-usage-widget", 2)).dataset.size).toBe("stat");
  });
});

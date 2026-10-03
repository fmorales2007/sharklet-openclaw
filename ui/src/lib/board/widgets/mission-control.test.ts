// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RpcSnapshot } from "../../../api/rpc.ts";
import type { GatewayAgentRow } from "../../../api/types.ts";
import type { MissionControlSources } from "../../mission-control/sources.ts";
import { getPluginWidgetKindContribution } from "./index.ts";
import "./mission-control.ts";
import { setMissionControlSources, staticResource } from "./mission-control-sources.ts";

type Agents = readonly GatewayAgentRow[];

function sources(agents: ReturnType<typeof staticResource<Agents>>): MissionControlSources {
  const idle = staticResource<never>({ state: "loading", since: Date.now() });
  return { workingNow: idle, upNext: idle, monthUsage: idle, agents };
}

async function mount(size = 3) {
  const element = document.createElement("sharklet-agents-widget") as HTMLElement & {
    widget?: unknown;
    updateComplete: Promise<boolean>;
  };
  element.widget = { sizeW: 4, sizeH: size };
  document.body.append(element);
  await element.updateComplete;
  return element;
}

const ready = (data: Agents): RpcSnapshot<Agents> => ({
  state: "ready",
  data,
  fetchedAt: Date.now(),
  stale: false,
});

const agents = [{ id: "main", identity: { name: "Example assistant" } }] as Agents;

afterEach(() => {
  document.body.replaceChildren();
  setMissionControlSources(null);
});

describe("agents widget", () => {
  it("registers Sharklet kinds without the gateway advertising them", () => {
    expect(getPluginWidgetKindContribution("sharklet:agents", [])?.tagName).toBe(
      "sharklet-agents-widget",
    );
    expect(getPluginWidgetKindContribution("other:agents", [])).toBeNull();
    // Working now, usage and Up next moved to the strip.
    expect(getPluginWidgetKindContribution("sharklet:working-now", [])).toBeNull();
  });

  it("names itself in its body and lists the agents", async () => {
    setMissionControlSources(sources(staticResource(ready(agents))));
    const el = await mount();
    expect(el.querySelector(".sk-widget__head b")?.textContent).toBe("Agents");
    expect(el.textContent).toContain("Example assistant");
  });

  it("loads with a skeleton, never text inside it", async () => {
    setMissionControlSources(sources(staticResource({ state: "loading", since: Date.now() })));
    const el = await mount();
    const state = el.querySelector(".sk-state--loading");
    expect(state?.getAttribute("aria-label")).toBe("Loading Agents");
    expect(state?.querySelectorAll(".sk-skeleton").length).toBeGreaterThan(0);
    expect(state?.textContent?.trim()).toBe("");
  });

  it("errors inside the widget and retries only that widget", async () => {
    const refresh = vi.fn();
    const error: RpcSnapshot<Agents> = {
      state: "error",
      kind: "unreachable",
      method: "agents.list",
      message: "Couldn’t reach the gateway. Check that it is running, then try again.",
      detail: "ECONNREFUSED",
      retryable: true,
    };
    setMissionControlSources(sources(staticResource(error, refresh)));
    const el = await mount();
    expect(el.querySelector(".sk-state--error")?.getAttribute("role")).toBe("status");
    expect(el.querySelector("details code")?.textContent).toBe("ECONNREFUSED");
    el.querySelector<HTMLButtonElement>(".sk-state--error button")?.click();
    expect(refresh).toHaveBeenCalledOnce();
  });

  it("keeps the last agents under an inline error", async () => {
    const error: RpcSnapshot<Agents> = {
      state: "error",
      kind: "timeout",
      method: "agents.list",
      message: "Timed out.",
      retryable: true,
      last: { data: agents, fetchedAt: Date.now() },
    };
    setMissionControlSources(sources(staticResource(error)));
    const el = await mount();
    expect(el.textContent).toContain("Example assistant");
    expect(el.querySelector(".sk-state--inline")).not.toBeNull();
  });

  it("is neutral when off, with no retry", async () => {
    setMissionControlSources(
      sources(
        staticResource({
          state: "off",
          reason: "disabled",
          method: "agents.list",
          message: "Off while it is being fixed.",
        }),
      ),
    );
    const el = await mount();
    expect(el.querySelector(".sk-state--off b")?.textContent).toBe("Turned off");
    expect(el.querySelector("button")).toBeNull();
  });

  it("marks the size so states can shed parts", async () => {
    setMissionControlSources(sources(staticResource(ready(agents))));
    expect((await mount(2)).dataset.size).toBe("stat");
  });
});

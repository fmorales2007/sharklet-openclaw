// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RpcSnapshot, UpNextJob } from "../../api/rpc.ts";
import type { GatewayAgentRow, GatewaySessionRow } from "../../api/types.ts";
import {
  setMissionControlSources,
  staticResource,
} from "../../lib/board/widgets/mission-control-sources.ts";
import type { MissionControlSources, MonthUsage } from "../../lib/mission-control/sources.ts";
import "./mission-control-strip.ts";

const ready = <T>(data: T): RpcSnapshot<T> => ({
  state: "ready",
  data,
  fetchedAt: Date.now(),
  stale: false,
});

const rows = [
  { key: "agent:main:a", label: "Refactor billing", status: "running", updatedAt: 1 },
  { key: "agent:writer:b", label: "Draft notes", status: "queued", updatedAt: 2 },
] as GatewaySessionRow[];
const jobs: UpNextJob[] = [
  { id: "0", name: "Running sync", enabled: true, state: { runningAtMs: Date.now() } },
  { id: "1", name: "Inbox digest", enabled: true, state: { nextRunAtMs: Date.now() + 60_000 } },
  { id: "2", name: "Backup", enabled: true, state: { nextRunAtMs: Date.now() + 120_000 } },
];
const usage: MonthUsage = {
  spentUsd: 6.42,
  startDate: "2026-10-01",
  endDate: "2026-10-15",
  updatedAt: 1,
  budgetUsd: null,
};

function sources(overrides: Partial<MissionControlSources> = {}): MissionControlSources {
  return {
    workingNow: staticResource(ready(rows)),
    upNext: staticResource(ready(jobs)),
    monthUsage: staticResource(ready(usage)),
    agents: staticResource(ready([] as GatewayAgentRow[])),
    ...overrides,
  };
}

type Strip = HTMLElement & { updateComplete: Promise<boolean> };

async function mount() {
  const strip = document.createElement("sharklet-mission-strip") as Strip;
  document.body.append(strip);
  await strip.updateComplete;
  return strip;
}

afterEach(() => {
  document.body.replaceChildren();
  setMissionControlSources(null);
});

describe("sharklet-mission-strip", () => {
  it("shows the count, expands to the jobs and lists the next routine", async () => {
    setMissionControlSources(sources());
    const strip = await mount();
    const toggle = strip.querySelector<HTMLButtonElement>(".sk-working")!;
    expect(toggle.textContent).toContain("2 working");
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    toggle.click();
    await strip.updateComplete;
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(strip.querySelectorAll(".sk-job .sk-job-task")).toHaveLength(2);
    expect(strip.querySelector(".sk-upnext")?.textContent).toContain("Inbox digest");
    expect(strip.querySelector(".sk-upnext button")?.textContent?.trim()).toBe("1 more");
  });

  it("states the spend and no budget without drawing an arc", async () => {
    setMissionControlSources(sources());
    const strip = await mount();
    expect(strip.querySelector(".sk-usage-btn")?.getAttribute("aria-label")).toBe(
      "Spent $6.42 this month. No budget set.",
    );
    expect(strip.querySelector(".sk-ring")?.getAttribute("data-budget")).toBe("none");
    expect(strip.querySelector(".sk-ring .tick")).toBeNull();
    expect(strip.querySelector(".sk-strip-usage")?.textContent).toContain("Set a budget");
  });

  it("draws the arc and projection tick with a budget, and warns at 70% and 90%", async () => {
    const withBudget = async (spentUsd: number, budgetUsd: number) => {
      setMissionControlSources(
        sources({ monthUsage: staticResource(ready({ ...usage, spentUsd, budgetUsd })) }),
      );
      const strip = await mount();
      const ring = strip.querySelector(".sk-ring")!;
      const seen = {
        level: ring.getAttribute("data-level"),
        budget: ring.getAttribute("data-budget"),
        ticks: ring.querySelectorAll(".tick").length,
        arc: Number(ring.querySelector(".value")!.getAttribute("stroke-dasharray")!.split(" ")[0]),
        label: strip.querySelector(".sk-usage-btn")!.getAttribute("aria-label"),
      };
      strip.remove();
      return seen;
    };
    const plain = await withBudget(5, 20);
    expect(plain).toMatchObject({ level: null, budget: "set", ticks: 1 });
    expect(plain.arc).toBeGreaterThan(0);
    expect(await withBudget(14, 20)).toMatchObject({ level: "warn", ticks: 1 });
    expect(await withBudget(18, 20)).toMatchObject({ level: "bad", ticks: 1 });
    // A budget with nothing spent is a zero, not the no-budget state: solid track, no arc.
    expect(await withBudget(0, 20)).toMatchObject({
      level: null,
      budget: "set",
      ticks: 0,
      arc: 0,
      label: "Spent $0.00 of $20.00 this month.",
    });
  });

  it("fails one section at a time and retries only that one", async () => {
    const refresh = vi.fn();
    const error: RpcSnapshot<MonthUsage> = {
      state: "error",
      kind: "unreachable",
      method: "usage.cost",
      message: "Couldn’t reach the gateway. Check that it is running, then try again.",
      retryable: true,
    };
    setMissionControlSources(sources({ monthUsage: staticResource(error, refresh) }));
    const strip = await mount();
    expect(strip.querySelector(".sk-working")?.textContent).toContain("2 working");
    strip.querySelector<HTMLButtonElement>(".sk-state--error button")!.click();
    expect(refresh).toHaveBeenCalledOnce();
  });
});

import { describe, expect, it } from "vitest";
import type { MonthUsage } from "../../lib/mission-control/sources.ts";
import { usageRing } from "./usage-ring.ts";

const usage = (spentUsd: number, budgetUsd: number | null): MonthUsage => ({
  spentUsd,
  budgetUsd,
  startDate: "2026-10-01",
  endDate: "2026-10-15",
  updatedAt: 1,
});

describe("usageRing", () => {
  it("has no arc and no tick without a budget, however much is spent", () => {
    expect(usageRing(usage(6.42, null))).toEqual({ mode: "none" });
    expect(usageRing(usage(0, null))).toEqual({ mode: "none" });
  });

  it("treats a budget with no spend as a zero, not as no budget", () => {
    expect(usageRing(usage(0, 20))).toEqual({ mode: "zero" });
  });

  it("projects the month from the pace so far", () => {
    // $5 in 15 days of a 31-day month is $10.33 by the end: 51.7% of $20.
    const ring = usageRing(usage(5, 20));
    expect(ring).toMatchObject({ mode: "spent", ratio: 0.25, level: undefined });
    expect(ring.mode === "spent" && ring.projected).toBeCloseTo(0.5167, 3);
  });

  it("turns warn at 70% and bad at 90%, and caps the arc at the whole ring", () => {
    expect(usageRing(usage(13.9, 20))).toMatchObject({ level: undefined });
    expect(usageRing(usage(14, 20))).toMatchObject({ level: "warn" });
    expect(usageRing(usage(18, 20))).toMatchObject({ level: "bad" });
    expect(usageRing(usage(30, 20))).toMatchObject({ ratio: 1, projected: 1, level: "bad" });
  });
});

// The usage ring's three states (board.md, "The usage ring with no budget").
// There is no default budget here or anywhere: a null budget draws no arc.
import { html, nothing, svg, type TemplateResult } from "lit";
import type { MonthUsage } from "../../lib/mission-control/sources.ts";

export type UsageRing =
  /** No denominator: dashed track, no arc, no tick. */
  | { mode: "none" }
  /** A budget and nothing spent: solid track, no arc. A zero, not an absence. */
  | { mode: "zero" }
  | {
      mode: "spent";
      /** Spent over budget, capped at 1 for the arc. */
      ratio: number;
      /** Month-end projection over budget, capped at 1, for the tick. */
      projected: number;
      level: "warn" | "bad" | undefined;
    };

function dayOfMonth(date: string): number {
  return Number(date.slice(8, 10)) || 1;
}

function daysInMonth(date: string): number {
  return new Date(Number(date.slice(0, 4)), Number(date.slice(5, 7)), 0).getDate();
}

export function usageRing(usage: MonthUsage): UsageRing {
  const budget = usage.budgetUsd;
  if (budget === null || !(budget > 0)) {
    return { mode: "none" };
  }
  if (usage.spentUsd <= 0) {
    return { mode: "zero" };
  }
  const ratio = usage.spentUsd / budget;
  const projection =
    (usage.spentUsd / dayOfMonth(usage.endDate)) * daysInMonth(usage.endDate) / budget;
  return {
    mode: "spent",
    ratio: Math.min(ratio, 1),
    projected: Math.min(projection, 1),
    level: ratio >= 0.9 ? "bad" : ratio >= 0.7 ? "warn" : undefined,
  };
}

const SIZE = 22;
const STROKE = 3;
const MID = SIZE / 2;
const RADIUS = (SIZE - STROKE) / 2;
const LENGTH = 2 * Math.PI * RADIUS;

export function renderUsageRing(ring: UsageRing): TemplateResult {
  const arc = ring.mode === "spent" ? ring.ratio : 0;
  // The svg is rotated -90deg by .sk-ring, so angle 0 is the top of the ring.
  const angle = ring.mode === "spent" ? 2 * Math.PI * ring.projected : 0;
  const tick = (offset: number) => ({
    x: MID + (RADIUS + offset) * Math.cos(angle),
    y: MID + (RADIUS + offset) * Math.sin(angle),
  });
  const inner = tick(-STROKE / 2 - 1);
  const outer = tick(STROKE / 2 + 1);
  return html`<svg
    class="sk-ring"
    width=${SIZE}
    height=${SIZE}
    viewBox="0 0 ${SIZE} ${SIZE}"
    data-budget=${ring.mode === "none" ? "none" : "set"}
    data-level=${(ring.mode === "spent" && ring.level) || nothing}
    aria-hidden="true"
  >
    <circle class="track" cx=${MID} cy=${MID} r=${RADIUS} fill="none" stroke-width=${STROKE} />
    <circle
      class="value"
      cx=${MID}
      cy=${MID}
      r=${RADIUS}
      fill="none"
      stroke-width=${STROKE}
      stroke-dasharray="${LENGTH * arc} ${LENGTH}"
    />
    ${
      ring.mode === "spent"
        ? svg`<line class="tick" x1=${inner.x} y1=${inner.y} x2=${outer.x} y2=${outer.y} stroke-width="1.5" />`
        : nothing
    }
  </svg>`;
}

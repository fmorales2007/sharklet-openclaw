import { describe, expect, it } from "vitest";
import { applyLocalOps, defaultMissionControlSnapshot } from "./board-state.ts";

const names = (snapshot: ReturnType<typeof defaultMissionControlSnapshot>) =>
  snapshot.widgets.toSorted((a, b) => a.position - b.position).map((w) => w.name);

describe("mission control board state", () => {
  it("starts with the four widgets as 4 x 3 cards", () => {
    const snapshot = defaultMissionControlSnapshot();
    expect(names(snapshot)).toEqual([
      "sharklet-month-usage",
      "sharklet-working-now",
      "sharklet-up-next",
      "sharklet-agents",
    ]);
    expect(snapshot.widgets.every((w) => w.sizeW === 4 && w.sizeH === 3)).toBe(true);
  });

  it("moves, resizes and removes", () => {
    let snapshot = defaultMissionControlSnapshot();
    snapshot = applyLocalOps(snapshot, [
      { kind: "widget_move", name: "sharklet-agents", position: 0 },
      { kind: "widget_resize", name: "sharklet-up-next", sizeW: 6, sizeH: 4 },
      { kind: "widget_remove", name: "sharklet-working-now" },
    ]);
    expect(names(snapshot)).toEqual([
      "sharklet-agents",
      "sharklet-month-usage",
      "sharklet-up-next",
    ]);
    expect(snapshot.widgets.find((w) => w.name === "sharklet-up-next")).toMatchObject({
      sizeW: 6,
      sizeH: 4,
    });
    expect(snapshot.revision).toBe(2);
  });
});

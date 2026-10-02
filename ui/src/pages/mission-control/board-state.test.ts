import { describe, expect, it } from "vitest";
import { applyLocalOps, defaultMissionControlSnapshot } from "./board-state.ts";

const names = (snapshot: ReturnType<typeof defaultMissionControlSnapshot>) =>
  snapshot.widgets.toSorted((a, b) => a.position - b.position).map((w) => w.name);

describe("mission control board state", () => {
  it("starts with the agents widget as a 4 x 3 card; the strip carries the rest", () => {
    const snapshot = defaultMissionControlSnapshot();
    expect(names(snapshot)).toEqual(["sharklet-agents"]);
    expect(snapshot.widgets.every((w) => w.sizeW === 4 && w.sizeH === 3)).toBe(true);
  });

  it("resizes and removes", () => {
    let snapshot = defaultMissionControlSnapshot();
    snapshot = applyLocalOps(snapshot, [
      { kind: "widget_resize", name: "sharklet-agents", sizeW: 6, sizeH: 4 },
    ]);
    expect(snapshot.widgets[0]).toMatchObject({ sizeW: 6, sizeH: 4 });
    snapshot = applyLocalOps(snapshot, [{ kind: "widget_remove", name: "sharklet-agents" }]);
    expect(names(snapshot)).toEqual([]);
    expect(snapshot.revision).toBe(3);
  });
});

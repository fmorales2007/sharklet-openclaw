// Mission Control's board while there is no gateway-side board for it: the
// default layout and the three edits the board view can ask for. Nothing is
// persisted yet (pending in the F1-03 task log); a reload restores the default.
import { t } from "../../i18n/index.ts";
import type { BoardOp, BoardSnapshot, BoardWidget } from "../../lib/board/types.ts";

export const MISSION_CONTROL_SESSION_KEY = "mission-control";
const TAB_ID = "home";

const KINDS = ["agents"] as const;

function widget(kind: (typeof KINDS)[number], position: number): BoardWidget {
  return {
    name: `sharklet-${kind}`,
    tabId: TAB_ID,
    contentKind: "plugin",
    pluginKind: `sharklet:${kind}`,
    presentation: "card",
    // Card, 4 x 3 (board.md): a ring with its reading, or up to three rows.
    sizeW: 4,
    sizeH: 3,
    position,
    grantState: "none",
    revision: 1,
  };
}

export function defaultMissionControlSnapshot(): BoardSnapshot {
  return {
    sessionKey: MISSION_CONTROL_SESSION_KEY,
    revision: 1,
    tabs: [{ tabId: TAB_ID, title: t("missionControl.homeTab"), position: 0, chatDock: "hidden" }],
    widgets: KINDS.map(widget),
  };
}

function reindex(widgets: BoardWidget[]): BoardWidget[] {
  return widgets.map((entry, position) => ({ ...entry, position }));
}

export function applyLocalOps(snapshot: BoardSnapshot, ops: readonly BoardOp[]): BoardSnapshot {
  let widgets = snapshot.widgets.toSorted((a, b) => a.position - b.position);
  for (const op of ops) {
    if (op.kind === "widget_remove") {
      widgets = widgets.filter((entry) => entry.name !== op.name);
    } else if (op.kind === "widget_resize") {
      widgets = widgets.map((entry) =>
        entry.name === op.name ? { ...entry, sizeW: op.sizeW, sizeH: op.sizeH } : entry,
      );
    } else if (op.kind === "widget_move") {
      const moving = widgets.find((entry) => entry.name === op.name);
      if (!moving) {
        continue;
      }
      const rest = widgets.filter((entry) => entry !== moving);
      const afterIndex = op.after ? rest.findIndex((entry) => entry.name === op.after) : -1;
      const index = op.after ? afterIndex + 1 : Math.min(op.position ?? rest.length, rest.length);
      rest.splice(index, 0, moving);
      widgets = rest;
    }
  }
  return { ...snapshot, revision: snapshot.revision + 1, widgets: reindex(widgets) };
}

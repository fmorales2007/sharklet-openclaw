// Where Mission Control's widgets read their data. The page owns the value
// (it sets it on connect); widgets are created by the board with only
// `.widget`, `.session` and `.active`, so they cannot be handed sources.
import type { RpcResource, RpcSnapshot } from "../../../api/rpc.ts";
import type { MissionControlSources } from "../../mission-control/sources.ts";

let current: MissionControlSources | null = null;

export function setMissionControlSources(sources: MissionControlSources | null): void {
  current = sources;
}

export function getMissionControlSources(): MissionControlSources | null {
  return current;
}

/** A resource frozen on one snapshot; `onRefresh` lets Try again do something. */
export function staticResource<T>(
  snapshot: RpcSnapshot<T>,
  onRefresh?: () => void,
): RpcResource<T> {
  return {
    snapshot,
    subscribe: () => () => undefined,
    refresh: () => onRefresh?.(),
    cancel: () => undefined,
    dispose: () => undefined,
  };
}

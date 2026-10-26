// How full the files behind You are, against the limits the gateway reports for an
// agent (`agents.files.list` → limits). Nothing here knows a number: the limits are
// data from the gateway, the count is the gateway's own function.
import { bootstrapContentChars } from "../../../../src/agents/bootstrap-chars.ts";
import type { AgentFilesLimits } from "../../api/rpc.ts";

/** What the gateway truncates by for one agent, plus the memory size it advises. */
export type YouLimits = AgentFilesLimits;

export type FileUsage = {
  chars: number;
  limit: number;
  ratio: number;
  /** Within the last stretch before the limit: time to trim. */
  near: boolean;
  over: boolean;
};

// The gateway warns at the same point (bootstrap-budget.ts, near-limit ratio).
const NEAR_LIMIT_RATIO = 0.85;

export function fileUsage(content: string, limit: number): FileUsage {
  const chars = bootstrapContentChars(content);
  return {
    chars,
    limit,
    ratio: limit > 0 ? chars / limit : 0,
    near: chars >= Math.ceil(limit * NEAR_LIMIT_RATIO),
    over: chars > limit,
  };
}

// The four live values Mission Control reads, each over an existing gateway
// method. Contract fixed in F1-02; F1-06 implements it on `rpcResource`.
import { rpcResource, type RpcClient, type RpcResource } from "../../api/rpc.ts";
import type { CronJob, GatewayAgentRow, GatewaySessionRow } from "../../api/types.ts";
import { buildSessionUsageDateParams } from "../sessions/usage.ts";

export type MonthUsage = {
  /** `usage.cost` → `totals.totalCost`, in US dollars. */
  spentUsd: number;
  /** First day of the current month, local time (YYYY-MM-DD). */
  startDate: string;
  /** Today, local time (YYYY-MM-DD). */
  endDate: string;
  updatedAt: number;
  /** Null until phase 3 brings a budget. Never a default (board.md, usage ring). */
  budgetUsd: number | null;
};

export type MissionControlSources = {
  /** Working now. `sessions.list` with `{ activeOnly: true }`: running or queued work. */
  workingNow: RpcResource<readonly GatewaySessionRow[]>;
  /**
   * Up next. `cron.list` with
   * `{ enabled: "enabled", sortBy: "nextRunAtMs", sortDir: "asc", includeDeliveryPreviews: false }`.
   */
  upNext: RpcResource<readonly CronJob[]>;
  /**
   * Month usage. `usage.cost` with `{ startDate, endDate, agentScope: "all" }`
   * plus `buildSessionUsageDateParams("local")`, as `requestUsageSnapshot` sends it.
   */
  monthUsage: RpcResource<MonthUsage>;
  /** Agents. `agents.list` with `{}`. */
  agents: RpcResource<readonly GatewayAgentRow[]>;
};

const localDay = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;

export function createMissionControlSources(client: RpcClient): MissionControlSources {
  const today = new Date();
  const startDate = localDay(new Date(today.getFullYear(), today.getMonth(), 1));
  const endDate = localDay(today);
  return {
    workingNow: rpcResource(client, "sessions.list", { activeOnly: true }, (r) => r.sessions),
    upNext: rpcResource(
      client,
      "cron.list",
      { enabled: "enabled", sortBy: "nextRunAtMs", sortDir: "asc", includeDeliveryPreviews: false },
      (r) => r.jobs,
    ),
    monthUsage: rpcResource(
      client,
      "usage.cost",
      { startDate, endDate, agentScope: "all", ...buildSessionUsageDateParams("local") },
      (r) => ({
        spentUsd: r.totals.totalCost,
        startDate,
        endDate,
        updatedAt: r.updatedAt,
        budgetUsd: null,
      }),
    ),
    agents: rpcResource(client, "agents.list", {}, (r) => r.agents),
  };
}

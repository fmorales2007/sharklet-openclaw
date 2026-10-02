// Mocked gateway responses for Mission Control's four values, in the
// control-ui-e2e format: pass to `installMockGateway(page, { methodResponses })`.
// Fixed in F1-02 and shared by both tracks; add new fixtures in your own file.
import type { AgentsListResult, CronJobsListResult, SessionsListResult } from "../api/types.ts";
import type { CostUsageSummary } from "../pages/usage/data-types.ts";

const NOW = Date.UTC(2026, 9, 15, 12);
const MINUTE = 60_000;

function cronJob(
  id: string,
  name: string,
  nextRunAtMs: number,
): CronJobsListResult["jobs"][number] {
  return {
    id,
    configRevision: `${id}-revision`,
    name,
    enabled: true,
    createdAtMs: NOW - 30 * 24 * 60 * MINUTE,
    updatedAtMs: NOW - 24 * 60 * MINUTE,
    schedule: { kind: "every", everyMs: 24 * 60 * MINUTE },
    sessionTarget: "main",
    wakeMode: "next-heartbeat",
    payload: { kind: "systemEvent", text: `Synthetic ${name.toLowerCase()}` },
    state: { nextRunAtMs, lastRunStatus: "ok" },
  };
}

const jobs = [
  cronJob("synthetic-inbox", "Inbox digest", NOW + 20 * MINUTE),
  cronJob("synthetic-backup", "Nightly backup", NOW + 6 * 60 * MINUTE),
  cronJob("synthetic-report", "Weekly report", NOW + 3 * 24 * 60 * MINUTE),
];

const totals = {
  input: 1_200_000,
  output: 240_000,
  cacheRead: 600_000,
  cacheWrite: 0,
  totalTokens: 2_040_000,
  totalCost: 6.42,
  inputCost: 3.6,
  outputCost: 2.4,
  cacheReadCost: 0.42,
  cacheWriteCost: 0,
  missingCostEntries: 0,
};

export function createMissionControlMethodResponses(): Record<string, unknown> {
  return {
    "sessions.list": {
      ts: NOW,
      path: "",
      count: 3,
      defaults: { modelProvider: "openai", model: "gpt-5.5", contextTokens: null },
      sessions: [
        {
          key: "agent:main:synthetic-refactor",
          kind: "direct",
          label: "Refactor the billing module",
          updatedAt: NOW - MINUTE,
          status: "running",
        },
        {
          key: "agent:writer:synthetic-draft",
          kind: "direct",
          label: "Draft the release notes",
          updatedAt: NOW - 3 * MINUTE,
          status: "running",
        },
        {
          key: "agent:main:synthetic-queued",
          kind: "direct",
          label: "Summarize the inbox",
          updatedAt: NOW - 5 * MINUTE,
          status: "queued",
        },
      ],
    } satisfies SessionsListResult,
    "cron.list": {
      jobs,
      snapshotRevision: "mission-control",
      total: jobs.length,
      offset: 0,
      limit: 50,
      hasMore: false,
      nextOffset: null,
    } satisfies CronJobsListResult,
    "usage.cost": {
      updatedAt: NOW,
      days: 15,
      daily: [],
      totals,
    } satisfies CostUsageSummary,
    "agents.list": {
      agents: [
        { id: "main", identity: { name: "Example assistant" }, name: "Example assistant" },
        { id: "writer", identity: { name: "Example writer" }, name: "Example writer" },
      ],
      defaultId: "main",
      mainKey: "main",
      scope: "agent",
    } satisfies AgentsListResult,
  };
}

/** The same scenario with `usage.cost` failing, for the error state. */
export function createMissionControlErrorResponses(): Record<string, unknown> {
  return {
    ...createMissionControlMethodResponses(),
    "usage.cost": {
      __mockError: { code: "UNAVAILABLE", message: "Usage is unavailable right now" },
    },
  };
}

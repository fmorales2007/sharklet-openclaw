import { describe, expect, it, vi } from "vitest";
import type { RpcClient } from "../../api/rpc.ts";
import { createMissionControlMethodResponses } from "../../e2e/mission-control-fixtures.test-support.ts";
import { createMissionControlSources } from "./sources.ts";

describe("createMissionControlSources", () => {
  it("asks the gateway for the four values and maps month usage", async () => {
    const responses = createMissionControlMethodResponses();
    const request = vi.fn(async (method: string, _params?: unknown) => responses[method]);
    const sources = createMissionControlSources({ request } as unknown as RpcClient);

    await vi.waitFor(() => {
      for (const source of Object.values(sources)) {
        expect(source.snapshot.state).toBe("ready");
      }
    });

    const paramsOf = (method: string) =>
      request.mock.calls.find(([m]) => m === method)?.[1] as Record<string, unknown>;
    expect(paramsOf("sessions.list")).toEqual({ activeOnly: true });
    expect(paramsOf("cron.list")).toMatchObject({ enabled: "enabled", sortBy: "nextRunAtMs" });
    expect(paramsOf("usage.cost")).toMatchObject({ agentScope: "all", mode: "specific" });
    expect(paramsOf("usage.cost").startDate).toMatch(/^\d{4}-\d{2}-01$/);

    expect(sources.monthUsage.snapshot).toMatchObject({
      data: { spentUsd: 6.42, budgetUsd: null },
    });
    expect(sources.workingNow.snapshot).toMatchObject({ data: [{}, {}, {}] });
  });
});

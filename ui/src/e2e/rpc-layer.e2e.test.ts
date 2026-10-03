import { expect, it } from "vitest";
import type { ApplicationRuntime } from "../app/bootstrap.ts";
import { installMockGateway, startControlUiE2eServer } from "../test-helpers/control-ui-e2e.ts";
import { createControlUiE2eSuite } from "./control-ui-e2e-suite.test-support.ts";
import { createMissionControlMethodResponses } from "./mission-control-fixtures.test-support.ts";

// The RPC layer runs in the page against the app's real gateway client and the
// mocked WebSocket. Mission Control (pista A) is not mounted yet, so the layer
// is driven directly; F1-03 covers its own UI over these resources.
const suite = createControlUiE2eSuite({
  name: "RPC layer",
  startServer: () => startControlUiE2eServer(undefined, { source: true }),
});

const cronParams = {
  enabled: "enabled",
  sortBy: "nextRunAtMs",
  sortDir: "asc",
  includeDeliveryPreviews: false,
} as const;

suite.define(() => {
  it("retries a transient failure and ends with data", async () => {
    await suite.withPage({ locale: "en-US", serviceWorkers: "block" }, async ({ page }) => {
      const responses = createMissionControlMethodResponses();
      // usage.cost: the chat page does not request it, so the sequence is ours alone.
      const gateway = await installMockGateway(page, {
        methodResponses: {
          ...responses,
          "usage.cost": {
            sequence: [
              {
                __mockError: { code: "UNAVAILABLE", message: "Usage is busy", retryable: true },
              },
              responses["usage.cost"],
            ],
          },
        },
      });
      await page.goto(`${suite.server.baseUrl}chat`, { timeout: 60_000 });
      await page.waitForFunction(() => {
        const app = document.querySelector<HTMLElement & { runtime?: ApplicationRuntime }>(
          "openclaw-app",
        );
        return Boolean(app?.runtime?.context.gateway.snapshot.client);
      });
      const rpc = await page.evaluateHandle<typeof import("../api/rpc.ts")>(
        'import("/src/api/rpc.ts")',
      );
      const outcome = await page.evaluate(
        async ({ rpc: layer, params }) => {
          const app = document.querySelector<HTMLElement & { runtime?: ApplicationRuntime }>(
            "openclaw-app",
          );
          const client = app!.runtime!.context.gateway.snapshot.client!;
          const result = await layer.rpcCall(client, "usage.cost", params);
          return result.ok ? { ok: true, spent: result.value.totals.totalCost } : { ok: false };
        },
        { rpc, params: { startDate: "2026-10-01", endDate: "2026-10-15" } },
      );
      expect(outcome).toEqual({ ok: true, spent: 6.42 });
      expect(await gateway.getRequests("usage.cost")).toHaveLength(2);
    });
  });

  it("shows the old data, marked, when a refresh fails", async () => {
    await suite.withPage({ locale: "en-US", serviceWorkers: "block" }, async ({ page }) => {
      const responses = createMissionControlMethodResponses();
      await installMockGateway(page, {
        methodResponses: {
          ...responses,
          "cron.list": {
            sequence: [
              responses["cron.list"],
              { __mockError: { code: "INVALID_REQUEST", message: "Scheduler rejected the call" } },
            ],
          },
        },
      });
      await page.goto(`${suite.server.baseUrl}chat`, { timeout: 60_000 });
      await page.waitForFunction(() => {
        const app = document.querySelector<HTMLElement & { runtime?: ApplicationRuntime }>(
          "openclaw-app",
        );
        return Boolean(app?.runtime?.context.gateway.snapshot.client);
      });
      const rpc = await page.evaluateHandle<typeof import("../api/rpc.ts")>(
        'import("/src/api/rpc.ts")',
      );
      const seen = await page.evaluate(
        async ({ rpc: layer, params }) => {
          const app = document.querySelector<HTMLElement & { runtime?: ApplicationRuntime }>(
            "openclaw-app",
          );
          const client = app!.runtime!.context.gateway.snapshot.client!;
          const resource = layer.rpcResource(client, "cron.list", params, (r) =>
            r.jobs.map((job) => job.name),
          );
          const states: unknown[] = [];
          const until = (state: string) =>
            new Promise<void>((resolve) => {
              if (resource.snapshot.state === state) {
                resolve();
                return;
              }
              const off = resource.subscribe((s) => {
                if (s.state === state) {
                  off();
                  resolve();
                }
              });
            });
          resource.subscribe((s) => states.push(s));
          await until("ready");
          resource.refresh();
          await until("error");
          return states;
        },
        { rpc, params: cronParams },
      );
      const names = ["Inbox digest", "Nightly backup", "Weekly report"];
      expect(seen.slice(-2)).toMatchObject([
        { state: "ready", data: names, stale: true },
        { state: "error", kind: "rejected", last: { data: names } },
      ]);
    });
  });
});

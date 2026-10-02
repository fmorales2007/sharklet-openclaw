import { expect, it } from "vitest";
import { installMockGateway } from "../test-helpers/control-ui-e2e.ts";
import { createControlUiE2eSuite } from "./control-ui-e2e-suite.test-support.ts";
import {
  createMissionControlErrorResponses,
  createMissionControlMethodResponses,
} from "./mission-control-fixtures.test-support.ts";

const suite = createControlUiE2eSuite({
  name: "Mission Control strip",
  startServerBeforeBrowser: true,
});

const STRIP = "sharklet-mission-strip";

suite.define(() => {
  it("expands Working now to the sessions in progress", async () => {
    await suite.withPage({ locale: "en-US", serviceWorkers: "block" }, async ({ page }) => {
      await installMockGateway(page, { methodResponses: createMissionControlMethodResponses() });
      await page.goto(suite.server.baseUrl, { timeout: 60_000 });
      const toggle = page.locator(`${STRIP} .sk-working`);
      await expect.poll(async () => toggle.textContent()).toContain("3 working");
      expect(await toggle.getAttribute("aria-expanded")).toBe("false");
      await toggle.click();
      expect(await toggle.getAttribute("aria-expanded")).toBe("true");
      const rows = page.locator(`${STRIP} .sk-job .sk-job-task`);
      expect(await rows.allTextContents()).toEqual([
        "Refactor the billing module",
        "Draft the release notes",
        "Summarize the inbox",
      ]);
    });
  });

  it("draws the ring without a budget as a dashed track and the real spend", async () => {
    await suite.withPage({ locale: "en-US", serviceWorkers: "block" }, async ({ page }) => {
      await installMockGateway(page, { methodResponses: createMissionControlMethodResponses() });
      await page.goto(suite.server.baseUrl, { timeout: 60_000 });
      const button = page.locator(`${STRIP} .sk-usage-btn`);
      await button.waitFor();
      expect(await button.getAttribute("aria-label")).toBe(
        "Spent $6.42 this month. No budget set.",
      );
      const ring = page.locator(`${STRIP} .sk-ring`);
      expect(await ring.getAttribute("data-budget")).toBe("none");
      expect(await ring.locator(".tick").count()).toBe(0);
      // No arc: the value circle is not painted at all.
      expect(await ring.locator(".value").evaluate((el) => getComputedStyle(el).display)).toBe(
        "none",
      );
      expect(
        await ring.locator(".track").evaluate((el) => getComputedStyle(el).strokeDasharray),
      ).not.toBe("none");
      expect(await button.textContent()).toContain("$6.42");
    });
  });

  it("lists the routines from cron.list in Up next", async () => {
    await suite.withPage({ locale: "en-US", serviceWorkers: "block" }, async ({ page }) => {
      await installMockGateway(page, { methodResponses: createMissionControlMethodResponses() });
      await page.goto(suite.server.baseUrl, { timeout: 60_000 });
      const line = page.locator(`${STRIP} .sk-upnext`);
      await expect.poll(async () => line.textContent()).toContain("Inbox digest");
      expect(await line.textContent()).toContain("2 more");
    });
  });

  it("keeps the other sections when usage fails", async () => {
    await suite.withPage({ locale: "en-US", serviceWorkers: "block" }, async ({ page }) => {
      await installMockGateway(page, { methodResponses: createMissionControlErrorResponses() });
      await page.goto(suite.server.baseUrl, { timeout: 60_000 });
      await page.locator(`${STRIP} .sk-state--error`).waitFor();
      expect(await page.locator(`${STRIP} .sk-working`).textContent()).toContain("3 working");
      expect(await page.locator(`${STRIP} .sk-upnext`).textContent()).toContain("Inbox digest");
    });
  });
});

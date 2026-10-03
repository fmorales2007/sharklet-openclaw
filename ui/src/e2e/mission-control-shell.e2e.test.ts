import { expect, it } from "vitest";
import { installMockGateway } from "../test-helpers/control-ui-e2e.ts";
import { createControlUiE2eSuite } from "./control-ui-e2e-suite.test-support.ts";
import { createMissionControlMethodResponses } from "./mission-control-fixtures.test-support.ts";
import { controlUiSessionPath } from "./new-session-page.test-support.ts";

const suite = createControlUiE2eSuite({
  name: "Mission Control shell",
  startServerBeforeBrowser: true,
});

const SESSION_KEY = "agent:main:dashboard:mission-control-send";

suite.define(() => {
  it("opens a new chat when a message is sent from the Mission Control composer", async () => {
    await suite.withPage({ locale: "en-US", serviceWorkers: "block" }, async ({ page }) => {
      const gateway = await installMockGateway(page, {
        methodResponses: {
          ...createMissionControlMethodResponses(),
          "sessions.create": {
            key: SESSION_KEY,
            entry: {
              model: "gpt-5.6-sol",
              modelProvider: "openai",
              sessionId: "session-mission-control-send",
              updatedAt: Date.now(),
            },
            runId: "run-mission-control-send",
            runStarted: true,
          },
        },
      });
      await page.goto(suite.server.baseUrl, { timeout: 60_000 });
      await expect.poll(() => new URL(page.url()).pathname).toBe("/home");
      const message = page.locator(".sk-mc__composer .new-session-page__message");
      await message.fill("plan the week");
      const start = page.locator(".sk-mc__composer .new-session-page__start-submit");
      await expect.poll(() => start.isEnabled()).toBe(true);
      await start.click();
      await expect(gateway.waitForRequest("sessions.create")).resolves.toMatchObject({
        params: { agentId: "main", message: "plan the week" },
      });
      await expect.poll(() => new URL(page.url()).pathname).toBe(controlUiSessionPath(SESSION_KEY));
    });
  });

  it("shows the compact bar in the header of other pages, and not on Home", async () => {
    await suite.withPage({ locale: "en-US", serviceWorkers: "block" }, async ({ page }) => {
      await installMockGateway(page, { methodResponses: createMissionControlMethodResponses() });
      await page.goto(`${suite.server.baseUrl}cron`, { timeout: 60_000 });
      const bar = page.locator("sharklet-mission-bar sharklet-mission-strip[compact]");
      await bar.waitFor();
      await expect
        .poll(async () => bar.locator(".sk-working").textContent())
        .toContain("3 working");
      expect(await bar.locator(".sk-usage-btn").count()).toBe(1);
      expect(await bar.locator(".sk-job").count()).toBe(0);

      await bar.locator(".sk-working").click();
      await expect.poll(() => new URL(page.url()).pathname).toBe("/home");
      await page.locator("sharklet-mission-strip:not([compact])").waitFor();
      expect(await page.locator("sharklet-mission-bar").count()).toBe(0);
    });
  });

  it("lists Home once in Ctrl K", async () => {
    await suite.withPage({ locale: "en-US", serviceWorkers: "block" }, async ({ page }) => {
      await installMockGateway(page, { methodResponses: createMissionControlMethodResponses() });
      await page.goto(suite.server.baseUrl, { timeout: 60_000 });
      await page.locator("sharklet-mission-strip").waitFor();
      await page.keyboard.press("Control+k");
      const search = page.getByPlaceholder("Search chats and commands…");
      await search.fill("Home");
      await page.getByRole("option").first().waitFor();
      const labels = (await page.getByRole("option").allTextContents()).map((text) =>
        text.replace(/\s+/g, " ").trim(),
      );
      expect(labels.filter((label) => label.startsWith("Home"))).toHaveLength(1);
    });
  });
});

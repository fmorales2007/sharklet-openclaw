import { expect, it } from "vitest";
import { installMockGateway } from "../test-helpers/control-ui-e2e.ts";
import { createControlUiE2eSuite } from "./control-ui-e2e-suite.test-support.ts";

// F1-07: the gateway's `ui.pages.off` switch, read through `pages.state`,
// turns a page into board.md's "Off" panel and back without a reload.
const suite = createControlUiE2eSuite({ name: "page off switch" });

suite.define(() => {
  it("shows the off state, flips with config.changed and never reloads the build", async () => {
    await suite.withPage({ locale: "en-US", serviceWorkers: "block" }, async ({ page }) => {
      const gateway = await installMockGateway(page, {
        methodResponses: {
          "pages.state": { off: [{ id: "usage", reason: "Usage is down for repairs." }] },
        },
      });
      await page.goto(`${suite.server.baseUrl}usage`, { timeout: 60_000 });
      await page.evaluate(() => {
        (window as unknown as { skNoReload: boolean }).skNoReload = true;
      });

      const off = page.locator('[data-test-id="page-off"]');
      await off.waitFor({ state: "visible" });
      expect(await off.textContent()).toContain("Usage is off");
      expect(await off.textContent()).toContain("Usage is down for repairs.");
      expect(await page.locator("openclaw-router-outlet").count()).toBe(0);

      await gateway.setMethodResponse("pages.state", { off: [] });
      await gateway.emitGatewayEvent("config.changed", {});
      await page.locator("openclaw-router-outlet").waitFor({ state: "attached" });
      expect(await off.count()).toBe(0);

      await gateway.setMethodResponse("pages.state", { off: [{ id: "usage" }] });
      await gateway.emitGatewayEvent("config.changed", {});
      await off.waitFor({ state: "visible" });
      expect(await off.textContent()).toContain("It was turned off on this gateway");

      expect(
        await page.evaluate(() => (window as unknown as { skNoReload?: boolean }).skNoReload),
      ).toBe(true);
    });
  });

  it("never switches off the way back, even when the gateway says so", async () => {
    await suite.withPage({ locale: "en-US", serviceWorkers: "block" }, async ({ page }) => {
      await installMockGateway(page, {
        methodResponses: { "pages.state": { off: [{ id: "chat" }, { id: "config" }] } },
      });
      await page.goto(`${suite.server.baseUrl}chat`, { timeout: 60_000 });
      await page.locator("openclaw-router-outlet").waitFor({ state: "attached" });
      expect(await page.locator('[data-test-id="page-off"]').count()).toBe(0);
    });
  });
});

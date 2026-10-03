import { expect, it } from "vitest";
import { installMockGateway } from "../test-helpers/control-ui-e2e.ts";
import { createControlUiE2eSuite } from "./control-ui-e2e-suite.test-support.ts";

// F1-07: Ctrl K opens the sk-palette, lists Sharklet's pages, searches and navigates.
const suite = createControlUiE2eSuite({ name: "command palette pages" });

suite.define(() => {
  it("opens, searches and navigates to a page, with an Off badge on a switched-off one", async () => {
    await suite.withPage({ locale: "en-US", serviceWorkers: "block" }, async ({ page }) => {
      await installMockGateway(page, {
        methodResponses: { "pages.state": { off: [{ id: "usage" }] } },
      });
      await page.goto(`${suite.server.baseUrl}chat?session=main`, { timeout: 60_000 });
      await page.locator(".shell").waitFor({ state: "visible" });
      await page.keyboard.press("Control+K");

      const input = page.locator(".sk-palette-input input:not([disabled])");
      await input.waitFor({ state: "visible" });
      const palette = page.locator(".sk-palette");
      expect((await palette.locator(".sk-menu-head").first().textContent())?.trim()).toBe("Pages");

      await input.fill("usage");
      const row = palette.getByRole("option", { name: /^Usage/u });
      await row.waitFor({ state: "visible" });
      await expect
        .poll(async () => (await row.locator(".sk-badge").textContent())?.trim())
        .toBe("Off");

      await page.keyboard.press("Enter");
      await page.waitForURL(/\/usage$/u);
      await page.locator('[data-test-id="page-off"]').waitFor({ state: "visible" });
    });
  });
});

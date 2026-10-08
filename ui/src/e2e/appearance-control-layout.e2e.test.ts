import { expect, it } from "vitest";
import {
  createControlUiMockBootstrapConfig,
  installMockGateway,
  waitForControlUiSettingsTakeover,
} from "../test-helpers/control-ui-e2e.ts";
import { createControlUiE2eSuite } from "./control-ui-e2e-suite.test-support.ts";

const suite = createControlUiE2eSuite({
  name: "Control UI Appearance control layout",
  startServerBeforeBrowser: true,
});

suite.define(() => {
  it("keeps the color-mode control laid out, with no theme, accent or typography pickers across responsive layouts", async () => {
    await suite.withPage(
      { colorScheme: "dark", locale: "en-US", viewport: { height: 1000, width: 1440 } },
      async ({ page }) => {
        const config = { ui: { prefs: { accent: "#c3cfdb", theme: "claw" } } };
        await installMockGateway(page, {
          methodResponses: {
            "config.get": {
              appliedConfigHash: "appearance-layout",
              config,
              configRevisionHash: "appearance-layout",
              hash: "appearance-layout",
              issues: [],
              raw: JSON.stringify(config),
              valid: true,
            },
          },
        });
        await page.route("**/control-ui-config.json", (route) =>
          route.fulfill({
            json: { ...createControlUiMockBootstrapConfig(), seamColor: "#123456" },
          }),
        );
        await page.goto(`${suite.server.baseUrl}settings/appearance`);
        await waitForControlUiSettingsTakeover(page);

        const appearanceHeadings = await page
          .locator(
            ".settings-page > .settings-section > .settings-section__header > .settings-section__heading",
          )
          .allTextContents();
        const themeIndex = appearanceHeadings.findIndex((heading) => heading.trim() === "Theme");
        expect(themeIndex).toBeGreaterThanOrEqual(0);
        const headings = appearanceHeadings.map((heading) => heading.trim());
        expect(headings).not.toContain("Accent color");
        expect(headings).not.toContain("Typography");

        // Sharklet has one theme family: no family cards and no tweakcn import.
        const theme = page.locator("#settings-appearance-theme");
        expect(await theme.locator(".settings-theme-grid, .settings-theme-import").count()).toBe(0);

        const colorMode = page
          .locator(".settings-row")
          .filter({ has: page.locator(".settings-row__title", { hasText: "Color mode" }) });
        await page.setViewportSize({ height: 1000, width: 768 });
        await expect
          .poll(() => colorMode.evaluate((element) => getComputedStyle(element).flexDirection))
          .toBe("column");
        await page.setViewportSize({ height: 1000, width: 769 });
        await expect
          .poll(() => colorMode.evaluate((element) => getComputedStyle(element).flexDirection))
          .toBe("row");
      },
    );
  });
});

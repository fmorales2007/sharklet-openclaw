// A phone reaches Help in one tap from the profile menu (F1-09); the floating "?" button only
// exists from 1160 px.
import { chromium, type Browser } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  canRunPlaywrightChromium,
  controlUiSessionUrl,
  installMockGateway,
  resolvePlaywrightChromiumExecutablePath,
  startControlUiE2eServer,
  type ControlUiE2eServer,
} from "../test-helpers/control-ui-e2e.ts";

const chromiumExecutablePath = resolvePlaywrightChromiumExecutablePath(chromium.executablePath());
const chromiumAvailable = canRunPlaywrightChromium(chromiumExecutablePath);
const allowMissingChromium = process.env.OPENCLAW_UI_E2E_ALLOW_MISSING_CHROMIUM === "1";
const describeControlUiE2e = chromiumAvailable || !allowMissingChromium ? describe : describe.skip;

const WORK_SESSION_KEY = "agent:main:work";

let browser: Browser;
let server: ControlUiE2eServer;

describeControlUiE2e("Control UI mobile Help row mocked Gateway E2E", () => {
  beforeAll(async () => {
    if (!chromiumAvailable) {
      throw new Error(`Playwright Chromium is unavailable at ${chromiumExecutablePath}`);
    }
    server = await startControlUiE2eServer();
    browser = await chromium.launch({ executablePath: chromiumExecutablePath });
  });

  afterAll(async () => {
    await browser?.close();
    await server?.close();
  });

  it("opens the Help panel with one tap on the profile menu's Help row at 390 px", async () => {
    const context = await browser.newContext({
      colorScheme: "dark",
      hasTouch: true,
      isMobile: true,
      locale: "en-US",
      serviceWorkers: "block",
      viewport: { height: 844, width: 390 },
    });
    const page = await context.newPage();
    await installMockGateway(page, {
      sessionKey: WORK_SESSION_KEY,
      featureMethods: [
        "chat.metadata",
        "chat.startup",
        "chat.history",
        "chat.send",
        "openclaw.chat",
        "openclaw.chat.history",
      ],
      methodResponses: {
        "openclaw.chat": {
          sessionId: "e2e-mobile-help",
          reply: "Ask me anything.",
          action: "none",
        },
        "openclaw.chat.history": {
          turns: [{ role: "assistant", text: "Channel repaired.", at: 1_700_000_101_000 }],
        },
      },
    });

    try {
      const response = await page.goto(controlUiSessionUrl(server.baseUrl, WORK_SESSION_KEY));
      expect(response?.status()).toBe(200);
      // The floating "?" button is hidden below 1160 px.
      await expect.poll(() => page.locator(".sk-help-btn").isVisible()).toBe(false);

      await page.getByRole("button", { name: "Expand sidebar", exact: true }).tap();
      const identity = page.locator(".sidebar-identity-card");
      await identity.waitFor({ state: "visible" });
      await identity.tap();

      const helpRow = page.locator(
        'wa-dropdown.sidebar-identity-menu wa-dropdown-item[value="command:open-help"]',
      );
      await helpRow.waitFor({ state: "visible" });
      const box = await helpRow.boundingBox();
      expect(box).not.toBeNull();
      expect(box!.y + box!.height).toBeLessThanOrEqual(844);
      await helpRow.tap();

      const panel = page.locator("openclaw-assistant-panel");
      await panel.getByText("Channel repaired.").waitFor();
    } finally {
      await context.close();
    }
  });
});

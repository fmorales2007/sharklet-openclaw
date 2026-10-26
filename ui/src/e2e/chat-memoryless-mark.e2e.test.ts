// Control UI E2E: a Memory-less chat says so in its header, always (F2-09). An ordinary chat
// shows nothing.
import { expect, it } from "vitest";
import { controlUiSessionUrl, installMockGateway } from "../test-helpers/control-ui-e2e.ts";
import { chatYouScenario } from "./chat-you-fixtures.test-support.ts";
import { createControlUiE2eSuite } from "./control-ui-e2e-suite.test-support.ts";

const suite = createControlUiE2eSuite({ name: "Control UI Memory-less mark" });
const MEMORYLESS_KEY = "agent:main:dashboard:fixture-memoryless";
const NORMAL_KEY = "agent:main:main";

async function open(sessionKey: string) {
  const context = await suite.browser.newContext({ viewport: { height: 800, width: 1200 } });
  const page = await context.newPage();
  await installMockGateway(page, {
    methodResponses: chatYouScenario("memoryless"),
    sessionKey,
  });
  await page.goto(controlUiSessionUrl(suite.server?.baseUrl ?? "", sessionKey));
  return { context, page };
}

suite.define(() => {
  it("shows Memory-less in the header of a Memory-less chat, and still after a reload", async () => {
    const { context, page } = await open(MEMORYLESS_KEY);
    try {
      const mark = page.locator('[data-test-id="memoryless-mark"]');
      await mark.waitFor({ timeout: 30_000 });
      expect((await mark.textContent())?.trim()).toBe("Memory-less");
      await page.reload();
      await mark.waitFor({ timeout: 30_000 });
    } finally {
      await context.close();
    }
  });

  it("shows nothing in an ordinary chat", async () => {
    const { context, page } = await open(NORMAL_KEY);
    try {
      await page.locator("openclaw-chat-pane, .chat-pane").first().waitFor({ timeout: 30_000 });
      await page.waitForTimeout(1_500);
      expect(await page.locator('[data-test-id="memoryless-mark"]').count()).toBe(0);
    } finally {
      await context.close();
    }
  });
});

// F2-02: one e2e per Home composer control (agent, $ skill, model, effort,
// attachment, Memory-less). Chat-side coverage lives in the chat-composer-* suites.
import { expect, it } from "vitest";
import {
  NEW_SESSION_MODEL_CATALOG,
  createNewSessionPageE2eSuite,
  installMockGateway,
  pastePng,
  pollLocatorText,
} from "./new-session-page.test-support.ts";

const suite = createNewSessionPageE2eSuite();

const AGENTS = {
  agents: [
    { id: "main", name: "Example assistant" },
    { id: "research", name: "Example researcher" },
  ],
  defaultId: "main",
  mainKey: "main",
  scope: "agent",
};

const SKILL_COMMAND = {
  name: "release_notes",
  description: "Draft release notes",
  source: "skill",
  skillModelVisible: true,
};

async function openHome(
  page: Parameters<Parameters<typeof suite.withPage>[1]>[0]["page"],
  methodResponses: Record<string, unknown> = {},
) {
  const gateway = await installMockGateway(page, {
    models: NEW_SESSION_MODEL_CATALOG,
    methodResponses: {
      "agents.list": AGENTS,
      "sessions.create": { key: "agent:main:composer-controls", runStarted: true },
      ...methodResponses,
    },
  });
  await page.goto(`${suite.server.baseUrl}new?agent=main`);
  await page.locator(".new-session-page__message").waitFor();
  return gateway;
}

suite.define(() => {
  it("chooses the agent for the new chat", async () => {
    await suite.withPage({ viewport: { width: 1280, height: 900 } }, async ({ page }) => {
      const gateway = await openHome(page);
      const picker = page.locator(".new-session-page__select--agent openclaw-agent-select");
      await picker.locator(".agent-select__trigger").click();
      await picker.getByRole("menuitemradio", { name: "Example researcher", exact: true }).click();
      await pollLocatorText(picker.locator(".agent-select__label")).toBe("Example researcher");
      await page.locator(".new-session-page__message").fill("look into it");
      await page.getByRole("button", { name: "Start session" }).click();
      const create = await gateway.waitForRequest("sessions.create");
      expect(create.params).toMatchObject({ agentId: "research" });
    });
  });

  it("inserts a skill with $", async () => {
    await suite.withPage({ viewport: { width: 1280, height: 900 } }, async ({ page }) => {
      const gateway = await openHome(page, { "commands.list": { commands: [SKILL_COMMAND] } });
      const message = page.locator(".new-session-page__message");
      await message.fill("$rel");
      await message.dispatchEvent("select");
      await gateway.waitForRequest("commands.list");
      const option = page.getByRole("listbox", { name: "Skill references" }).getByRole("option");
      await option.first().click();
      await expect.poll(() => message.inputValue()).toContain("$release_notes");
    });
  });

  it("changes the model", async () => {
    await suite.withPage({ viewport: { width: 1280, height: 900 } }, async ({ page }) => {
      const gateway = await openHome(page);
      const trigger = page.locator('[data-chat-model-select="true"]');
      await trigger.click();
      await page.getByRole("option", { name: /Claude Sonnet 4\.6/ }).click();
      await page.keyboard.press("Escape");
      await page.locator(".new-session-page__message").fill("use the other model");
      await page.getByRole("button", { name: "Start session" }).click();
      const create = await gateway.waitForRequest("sessions.create");
      expect(create.params).toMatchObject({ model: expect.stringContaining("claude-sonnet-4-6") });
    });
  });

  it("changes the effort", async () => {
    await suite.withPage({ viewport: { width: 1280, height: 900 } }, async ({ page }) => {
      const gateway = await openHome(page);
      const effort = page.locator('[data-chat-thinking-select="true"]');
      await effort.click();
      const slider = page.locator('[data-chat-thinking-slider="true"]');
      const index = await slider.evaluate(
        (el) => el.getAttribute("data-chat-thinking-values")?.split(",").indexOf("high") ?? -1,
      );
      expect(index).toBeGreaterThanOrEqual(0);
      await slider.fill(String(index));
      await expect.poll(() => effort.getAttribute("data-chat-thinking-value")).toBe("high");
      await page.keyboard.press("Escape");
      await page.locator(".new-session-page__message").fill("think harder");
      await page.getByRole("button", { name: "Start session" }).click();
      const create = await gateway.waitForRequest("sessions.create");
      expect(create.params).toMatchObject({ thinkingLevel: "high" });
    });
  });

  it("attaches a file", async () => {
    await suite.withPage({ viewport: { width: 1280, height: 900 } }, async ({ page }) => {
      const gateway = await openHome(page);
      await pastePng(page.locator(".new-session-page__message"));
      await page.getByRole("img", { name: "pixel.png" }).waitFor();
      await page.getByRole("button", { name: "Start session" }).click();
      const create = await gateway.waitForRequest("sessions.create");
      expect(create.params).toMatchObject({
        attachments: [{ type: "image", mimeType: "image/png" }],
      });
    });
  });

  it("creates a Memory-less chat, and an ordinary one without the mark", async () => {
    await suite.withPage({ viewport: { width: 1280, height: 900 } }, async ({ page }) => {
      const gateway = await openHome(page);
      const composer = page.locator(".new-session-page__composer");
      const menu = composer.locator("wa-dropdown.agent-chat__capability-menu");
      await composer.getByRole("button", { name: "Add attachment" }).click();
      await menu.getByRole("menuitem", { name: "Memory-less" }).click();
      await page.locator(".new-session-page__message").fill("keep this off the record");
      await page.getByRole("button", { name: "Start session" }).click();
      const create = await gateway.waitForRequest("sessions.create");
      expect(create.params).toMatchObject({ memoryless: true });
    });
    await suite.withPage({ viewport: { width: 1280, height: 900 } }, async ({ page }) => {
      const gateway = await openHome(page);
      await page.locator(".new-session-page__message").fill("normal chat");
      await page.getByRole("button", { name: "Start session" }).click();
      const create = await gateway.waitForRequest("sessions.create");
      expect(create.params).not.toHaveProperty("memoryless");
    });
  });
});

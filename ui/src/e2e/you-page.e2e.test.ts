// Control UI E2E: the You page against a mock Gateway that keeps agent files.
// Change Response style, save, and read it back from the "files" (F2-07).
import { expect, it } from "vitest";
import { installMockGateway } from "../test-helpers/control-ui-e2e.ts";
import type { ControlUiMockGateway } from "../test-helpers/control-ui-e2e.ts";
import { CHAT_YOU_AGENTS_LIST } from "./chat-you-fixtures.test-support.ts";
import { createControlUiE2eSuite } from "./control-ui-e2e-suite.test-support.ts";

const suite = createControlUiE2eSuite({
  name: "Control UI You page",
  browserLaunchOptions: { headless: true },
  startServerBeforeBrowser: true,
  unavailableMessage: (executablePath) =>
    `Playwright Chromium is not available at ${executablePath}`,
});

/** Installs in-page handlers that behave like agents.files.get/set with expectedHash. */
function installFileHandlers(
  page: import("playwright").Page,
  options: { userMaxChars?: number; userMd?: string } = {},
) {
  return page.evaluate((opts) => {
    const fixture = (window as Window & { openclawControlUiE2eGateway?: ControlUiMockGateway })
      .openclawControlUiE2eGateway;
    if (!fixture) {
      throw new Error("Mock Gateway is not installed");
    }
    const files = new Map<string, { content: string; version: number }>();
    if (opts.userMd) {
      files.set("main/USER.md", { content: opts.userMd, version: 1 });
    }
    const switches = new Map<string, Record<string, boolean>>();
    const updates: Array<Record<string, unknown>> = [];
    (window as unknown as { youE2eUpdates: typeof updates }).youE2eUpdates = updates;
    fixture.setRequestHandler("agents.files.list", ({ params, respond }) => {
      const { agentId } = params as { agentId: string };
      respond({
        agentId,
        workspace: `/tmp/openclaw-e2e/${agentId}`,
        files: [],
        limits: {
          fileMaxChars: 5000,
          totalMaxChars: 12000,
          userMaxChars: opts.userMaxChars ?? 900,
          memoryAdvisoryChars: 700,
        },
        personalContext: {
          aboutYou: true,
          responseStyle: true,
          skillRules: true,
          memory: true,
          ...switches.get(agentId),
        },
      });
    });
    fixture.setRequestHandler("agents.update", ({ params, respond }) => {
      const { agentId, personalContext } = params as {
        agentId: string;
        personalContext?: Record<string, boolean>;
      };
      updates.push(params as Record<string, unknown>);
      switches.set(agentId, { ...switches.get(agentId), ...personalContext });
      respond({ ok: true, agentId });
    });
    const hashOf = (version: number) => version.toString(16).padStart(64, "0");
    const writes: Array<{ agentId: string; name: string; content: string }> = [];
    (window as unknown as { youE2eWrites: typeof writes }).youE2eWrites = writes;
    fixture.setRequestHandler("agents.files.get", ({ params, respond }) => {
      const { agentId, name } = params as { agentId: string; name: string };
      const entry = files.get(`${agentId}/${name}`);
      respond({
        agentId,
        workspace: `/tmp/openclaw-e2e/${agentId}`,
        file: entry
          ? {
              name,
              path: `/tmp/openclaw-e2e/${agentId}/${name}`,
              missing: false,
              content: entry.content,
              hash: hashOf(entry.version),
            }
          : { name, path: `/tmp/openclaw-e2e/${agentId}/${name}`, missing: true },
      });
    });
    fixture.setRequestHandler("agents.files.set", ({ params, respond }) => {
      const { agentId, name, content } = params as {
        agentId: string;
        name: string;
        content: string;
      };
      const key = `${agentId}/${name}`;
      const version = (files.get(key)?.version ?? 0) + 1;
      files.set(key, { content, version });
      writes.push({ agentId, name, content });
      respond({
        ok: true,
        agentId,
        workspace: `/tmp/openclaw-e2e/${agentId}`,
        file: { name, path: `/tmp/openclaw-e2e/${agentId}/${name}`, missing: false, content },
      });
    });
  }, options);
}

suite.define(() => {
  it("saves a changed Response style and reads it back after a reload", async () => {
    await suite.withPage(
      { locale: "en-US", serviceWorkers: "block", viewport: { height: 900, width: 1440 } },
      async ({ page }) => {
        const gateway = await installMockGateway(page, {
          featureMethods: [
            "agents.files.get",
            "agents.files.set",
            "agents.files.list",
            "agents.update",
            "agents.list",
          ],
          methodResponses: { "agents.list": CHAT_YOU_AGENTS_LIST },
          operatorScopes: ["operator.admin", "operator.read", "operator.write"],
        });
        await page.goto(`${suite.server.baseUrl}you`);
        await installFileHandlers(page);
        await page.reload();
        await installFileHandlers(page);

        const save = page.locator('[data-test-id="you-save"]');
        await expect.poll(() => page.locator("#you-about").isEnabled()).toBe(true);
        expect(await save.isDisabled()).toBe(true);

        await page.locator('[data-test-id="you-tone-formal"]').click();
        await expect.poll(() => save.isEnabled()).toBe(true);
        await save.click();

        const set = await gateway.waitForRequest("agents.files.set");
        expect(set.params).toMatchObject({ agentId: "main", name: "USER.md" });
        expect((set.params as { content: string }).content).toContain("- Tone: formal");
        await expect.poll(() => save.isDisabled()).toBe(true);

        // Back from the file: a fresh load of the page shows the saved tone.
        const written = await page.evaluate(
          () => (window as unknown as { youE2eWrites: unknown[] }).youE2eWrites.length,
        );
        expect(written).toBe(1);
        const reads = (await gateway.getRequests("agents.files.get")).length;
        expect(reads).toBeGreaterThanOrEqual(3);
        const pressed = page.locator('[data-test-id="you-tone-formal"]');
        await expect.poll(async () => pressed.getAttribute("aria-checked")).toBe("true");
      },
    );
  });

  it("writes only to the agents picked in Also save to", async () => {
    await suite.withPage(
      { locale: "en-US", serviceWorkers: "block", viewport: { height: 900, width: 1440 } },
      async ({ page }) => {
        const gateway = await installMockGateway(page, {
          featureMethods: [
            "agents.files.get",
            "agents.files.set",
            "agents.files.list",
            "agents.update",
            "agents.list",
          ],
          methodResponses: { "agents.list": CHAT_YOU_AGENTS_LIST },
          operatorScopes: ["operator.admin", "operator.read", "operator.write"],
        });
        await page.goto(`${suite.server.baseUrl}you`);
        await installFileHandlers(page);
        await page.reload();
        await installFileHandlers(page);

        await expect.poll(() => page.locator("#you-about").isEnabled()).toBe(true);
        await page.getByLabel("Example writer").check();
        await page.locator("#you-about").fill("I run a bakery.");
        await page.locator('[data-test-id="you-save"]').click();
        await expect
          .poll(async () => (await gateway.getRequests("agents.files.set")).length)
          .toBe(2);
        const agents = (await gateway.getRequests("agents.files.set")).map(
          (request) => (request.params as { agentId: string }).agentId,
        );
        expect(agents.toSorted()).toEqual(["main", "writer"]);
      },
    );
  });

  const STATIC_FEATURES = [
    "agents.files.get",
    "agents.files.set",
    "agents.files.list",
    "agents.update",
    "agents.list",
  ];
  const staticList = (userMaxChars: number) => ({
    agentId: "main",
    workspace: "/tmp/openclaw-e2e/main",
    files: [],
    limits: { fileMaxChars: 5000, totalMaxChars: 12000, userMaxChars, memoryAdvisoryChars: 700 },
    personalContext: { aboutYou: true, responseStyle: true, skillRules: true, memory: true },
  });
  // Answers that exist from the first request: the page loads before a test can install handlers.
  const staticFile = (content?: string) => ({
    agentId: "main",
    workspace: "/tmp/openclaw-e2e/main",
    file: content
      ? { name: "USER.md", path: "/tmp/openclaw-e2e/main/USER.md", missing: false, content }
      : { name: "USER.md", path: "/tmp/openclaw-e2e/main/USER.md", missing: true },
  });

  it("warns when a file is over the limit the gateway reported", async () => {
    await suite.withPage(
      { locale: "en-US", serviceWorkers: "block", viewport: { height: 900, width: 1440 } },
      async ({ page }) => {
        await installMockGateway(page, {
          featureMethods: STATIC_FEATURES,
          methodResponses: {
            "agents.list": CHAT_YOU_AGENTS_LIST,
            "agents.files.list": staticList(80),
            "agents.files.get": staticFile(`# USER
${"x".repeat(120)}`),
          },
          operatorScopes: ["operator.admin", "operator.read", "operator.write"],
        });
        await page.goto(`${suite.server.baseUrl}you`);

        const userMeter = page.getByRole("meter", { name: "USER.md" });
        await expect.poll(() => userMeter.count(), { timeout: 30_000 }).toBe(1);
        expect(await userMeter.getAttribute("aria-valuemax")).toBe("80");
        await expect
          .poll(() =>
            page
              .getByText("USER.md is over its limit. The end of it won't reach the agent.")
              .count(),
          )
          .toBe(1);
      },
    );
  });

  it("switches a piece off for one agent without touching the text", async () => {
    await suite.withPage(
      { locale: "en-US", serviceWorkers: "block", viewport: { height: 900, width: 1440 } },
      async ({ page }) => {
        const gateway = await installMockGateway(page, {
          featureMethods: STATIC_FEATURES,
          methodResponses: {
            "agents.list": CHAT_YOU_AGENTS_LIST,
            "agents.files.list": staticList(900),
            "agents.files.get": staticFile(),
            "agents.update": { ok: true, agentId: "main" },
          },
          operatorScopes: ["operator.admin", "operator.read", "operator.write"],
        });
        await page.goto(`${suite.server.baseUrl}you`);

        const memory = page.getByRole("switch", { name: "Memory" });
        await memory.waitFor({ timeout: 30_000 });
        // The native input is visually hidden: click the switch itself (Memory is the fourth).
        await page.locator("wa-switch").nth(3).click();
        const update = await gateway.waitForRequest("agents.update");
        expect(update.params).toEqual({ agentId: "main", personalContext: { memory: false } });
        await expect
          .poll(() => page.getByText("Example assistant no longer reads Memory").count())
          .toBe(1);
        // A switch is not part of the draft: nothing to save, no file written.
        expect(await page.locator('[data-test-id="you-save"]').isDisabled()).toBe(true);
        expect(await gateway.getRequests("agents.files.set")).toHaveLength(0);
      },
    );
  });
});

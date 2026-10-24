import { expect, it } from "vitest";
import {
  createChatFlowE2eSuite,
  installMockGateway,
  requireRecord,
  requireString,
} from "./chat-flow.test-support.ts";

const suite = createChatFlowE2eSuite();

const now = Date.now();
const history = [
  {
    role: "user",
    content: "Check the workspace",
    timestamp: now - 60_000,
    __openclaw: { id: "user-1", seq: 1 },
  },
  {
    role: "assistant",
    content: [
      {
        type: "toolCall",
        id: "call-1",
        name: "exec",
        arguments: { command: "pnpm test", title: "Run the test suite" },
      },
    ],
    timestamp: now - 50_000,
    __openclaw: { id: "assistant-1", seq: 2 },
  },
  {
    role: "toolResult",
    toolCallId: "call-1",
    toolName: "exec",
    content: [{ type: "text", text: "All tests passed." }],
    timestamp: now - 40_000,
    __openclaw: { id: "tool-1", seq: 3 },
  },
  {
    role: "assistant",
    content: [{ type: "text", text: "The checks are complete." }],
    timestamp: now - 30_000,
    model: "openai/gpt-5.6-luna",
    usage: { input: 1200, output: 80, cost: { total: 0.0042 } },
    __openclaw: { id: "assistant-2", seq: 4 },
  },
];

suite.define(() => {
  it("shows tool steps as plain lines, the reply cost, and copy and retry actions", async () => {
    await suite.withPage(
      {
        locale: "en-US",
        permissions: ["clipboard-read", "clipboard-write"],
        serviceWorkers: "block",
        viewport: { height: 900, width: 1280 },
      },
      async ({ page }) => {
        const gateway = await installMockGateway(page, {
          featureMethods: ["chat.metadata", "chat.startup", "sessions.rewind"],
          historyMessages: history,
          methodResponses: { "sessions.rewind": { editorText: "Check the workspace" } },
        });
        await page.goto(`${suite.server.baseUrl}chat`);

        // The step is a line that is already on screen: no card to open.
        const step = page.locator(".chat-tool-row", { hasText: "Run the test suite" });
        await step.waitFor();
        expect(await page.locator(".chat-tool-row[aria-expanded]").count()).toBe(0);
        expect(await page.locator(".chat-tool-row__chevron").count()).toBe(0);
        expect(await page.locator(".chat-tool-msg-body").count()).toBe(0);

        // The cost is the usage the gateway reported, under a cent with three decimals.
        const reply = page.locator(".chat-group.assistant", {
          hasText: "The checks are complete.",
        });
        expect(await reply.locator(".chat-group-cost").textContent()).toBe("$0.004");

        // Copy puts the reply text on the clipboard.
        await reply.locator(".chat-copy-btn").click();
        await expect
          .poll(() => page.evaluate(() => navigator.clipboard.readText()))
          .toContain("The checks are complete.");

        // Retry rewinds to the prompt and asks again.
        await reply.locator(".chat-retry-btn").click();
        const rewind = await gateway.waitForRequest("sessions.rewind");
        expect(requireRecord(rewind.params).entryId).toBe("user-1");
        const send = await gateway.waitForRequest("chat.send");
        expect(requireString(requireRecord(send.params).message, "retry message")).toBe(
          "Check the workspace",
        );
      },
    );
  });

  it("swims at the chosen effort while the model thinks and holds still under reduced motion", async () => {
    for (const reducedMotion of ["no-preference", "reduce"] as const) {
      await suite.withPage(
        {
          locale: "en-US",
          reducedMotion,
          serviceWorkers: "block",
          viewport: { height: 900, width: 1280 },
        },
        async ({ page }) => {
          const gateway = await installMockGateway(page, {
            historyMessages: history,
            sessionInfo: { thinkingLevel: "high" },
          });
          await page.goto(`${suite.server.baseUrl}chat`);
          await page.locator(".agent-chat__composer-combobox textarea").fill("Think hard");
          await page.getByRole("button", { name: "Send message" }).click();
          await gateway.waitForRequest("chat.send");

          const shark = page.locator(".chat-working-indicator openclaw-mascot");
          await shark.waitFor();
          expect(await shark.getAttribute("data-effort")).toBe("high");
          await page
            .locator(
              ".chat-working-indicator openclaw-mascot svg animate, .chat-working-indicator openclaw-mascot svg animateTransform",
            )
            .first()
            .waitFor({ state: "attached" });
          const cycle = await shark.evaluate((element) =>
            element.querySelector("animateTransform, animate")?.getAttribute("dur"),
          );
          expect(cycle).toBe("0.95s");
          const paused = await shark.evaluate((element) =>
            (element.querySelector("svg") as SVGSVGElement | null)?.animationsPaused(),
          );
          expect(paused).toBe(reducedMotion === "reduce");
        },
      );
    }
  });
});

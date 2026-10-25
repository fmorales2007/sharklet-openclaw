// Control UI E2E: the Needs you card resolves approvals, and finished-task notices
// stack three at most, leave after six seconds and stay in the bell's history.
import { createRequireRecord } from "openclaw/plugin-sdk/test-fixtures";
import type { Page } from "playwright";
import { afterEach, expect, it } from "vitest";
import { controlUiSessionUrl, installMockGateway } from "../test-helpers/control-ui-e2e.ts";
import { createControlUiE2eSuite } from "./control-ui-e2e-suite.test-support.ts";

const suite = createControlUiE2eSuite({ name: "Control UI needs you and notices" });
const sessionKey = "agent:main:main";
const requireRecord = createRequireRecord("record", "expected-object-value");
let page: Page | undefined;

function approval(id: string) {
  return {
    id,
    createdAtMs: 1_000,
    expiresAtMs: Date.now() + 60_000,
    request: { command: `echo ${id}`, agentId: "main", sessionKey },
  };
}

async function open() {
  const context = await suite.browser.newContext({ viewport: { height: 800, width: 1200 } });
  const currentPage = await context.newPage();
  page = currentPage;
  const gateway = await installMockGateway(currentPage, { sessionKey });
  await currentPage.goto(controlUiSessionUrl(suite.server?.baseUrl ?? "", sessionKey));
  await gateway.waitForRequest("sessions.list");
  return { currentPage, gateway };
}

type Gateway = Awaited<ReturnType<typeof open>>["gateway"];

async function resolveRequests(gateway: Gateway) {
  return (await gateway.getRequests("exec.approval.resolve")).map((request) =>
    requireRecord(request.params),
  );
}

suite.define(() => {
  afterEach(async () => {
    await page
      ?.context()
      .close()
      .catch(() => {});
    page = undefined;
  });

  it.each([
    ["Allow once", "allow-once"],
    ["Always allow here", "allow-always"],
    ["Deny", "deny"],
  ])("sends %s from the card to the gateway", async (label, decision) => {
    const { currentPage, gateway } = await open();
    await gateway.emitGatewayEvent("exec.approval.requested", approval("approval-1"));
    const card = currentPage.locator('.chat-inline-approval [data-approval-id="approval-1"]');
    await card.waitFor();
    await card.getByRole("button", { name: label, exact: true }).click();
    await expect.poll(async () => (await resolveRequests(gateway)).length).toBe(1);
    expect((await resolveRequests(gateway))[0]).toMatchObject({ id: "approval-1", decision });
  });

  it("denies with the typed explanation and sends it to the session as a steer message", async () => {
    const { currentPage, gateway } = await open();
    await gateway.emitGatewayEvent("exec.approval.requested", approval("approval-2"));
    const card = currentPage.locator('.chat-inline-approval [data-approval-id="approval-2"]');
    await card.waitFor();
    await card.getByRole("button", { name: "Deny and explain", exact: true }).click();
    const send = card.getByRole("button", { name: "Deny and send", exact: true });
    expect(await send.isDisabled()).toBe(true);
    await card.getByRole("textbox").fill("Use the staging folder instead");
    await send.click();
    await expect.poll(async () => (await resolveRequests(gateway)).length).toBe(1);
    expect((await resolveRequests(gateway))[0]).toMatchObject({
      id: "approval-2",
      decision: "deny",
    });
    const note = requireRecord((await gateway.waitForRequest("chat.send")).params);
    expect(note).toMatchObject({
      sessionKey,
      message: "Use the staging folder instead",
      queueMode: "steer",
    });
  });

  it("shows three notices at most, drops each after six seconds and keeps all five in the bell", async () => {
    const { currentPage, gateway } = await open();
    // Paused, so only runFor moves time and the six seconds are exact.
    await currentPage.clock.install({ time: 0 });
    await currentPage.clock.pauseAt(1_000);
    for (let n = 1; n <= 5; n += 1) {
      await gateway.emitGatewayEvent("task", {
        action: "upserted",
        task: { id: `task-${n}`, status: "completed", title: `Task ${n}` },
      });
    }
    const notices = currentPage.locator("[data-task-notice]");
    await expect.poll(() => notices.count()).toBe(3);
    expect(await notices.allTextContents()).toEqual([
      expect.stringContaining("Task 3 finished"),
      expect.stringContaining("Task 4 finished"),
      expect.stringContaining("Task 5 finished"),
    ]);
    await currentPage.clock.runFor(5_900);
    expect(await notices.count()).toBe(3);
    await currentPage.clock.runFor(200);
    await expect.poll(() => notices.count()).toBe(0);

    await currentPage.getByRole("button", { name: "Notifications", exact: true }).click();
    const history = currentPage.locator("[data-notice-history]");
    await expect.poll(() => history.count()).toBe(5);
    expect(await history.first().textContent()).toContain("Task 5 finished");
  });
});

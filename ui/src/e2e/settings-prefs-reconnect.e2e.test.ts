// Control UI tests cover server preference replay and reconciliation through real reconnects.
import type { BrowserContext, Page } from "playwright";
import { expect, it } from "vitest";
import {
  controlUiBundledSettingsStorageKey,
  installMockGateway,
  type MockGatewayControls,
  type MockGatewayRequest,
} from "../test-helpers/control-ui-e2e.ts";
import { createControlUiE2eSuite } from "./control-ui-e2e-suite.test-support.ts";

const suite = createControlUiE2eSuite({
  name: "Control UI server prefs reconnect sync",
  startServerBeforeBrowser: true,
  unavailableMessage: (executablePath) =>
    `Playwright Chromium is not available at ${executablePath}. Run \`pnpm --dir ui exec playwright install --with-deps chromium\`, or set OPENCLAW_UI_E2E_ALLOW_MISSING_CHROMIUM=1 only when intentionally skipping this lane.`,
});

function configResponse(prefs: Record<string, unknown>, hash: string) {
  const config = { ui: { prefs } };
  return {
    config,
    hash,
    configRevisionHash: hash,
    appliedConfigHash: hash,
    issues: [],
    raw: JSON.stringify(config),
    valid: true,
  };
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  expect(value, label).toBeTruthy();
  expect(typeof value, label).toBe("object");
  expect(Array.isArray(value), label).toBe(false);
  return value as Record<string, unknown>;
}

function patchPrefs(request: MockGatewayRequest): Record<string, unknown> {
  const params = requireRecord(request.params, "config.patch params");
  expect(Object.hasOwn(params, "baseHash")).toBe(false);
  expect(typeof params.raw).toBe("string");
  const parsed = requireRecord(JSON.parse(String(params.raw)), "config.patch raw");
  const ui = requireRecord(parsed.ui, "config.patch ui");
  return requireRecord(ui.prefs, "config.patch ui.prefs");
}

async function createContext(colorScheme?: "dark" | "light"): Promise<BrowserContext> {
  return suite.browser.newContext({
    ...(colorScheme ? { colorScheme } : {}),
    locale: "en-US",
    serviceWorkers: "block",
    viewport: { height: 900, width: 1440 },
  });
}

async function waitForRequestCount(
  gateway: MockGatewayControls,
  method: string,
  count: number,
): Promise<void> {
  await expect
    .poll(async () => (await gateway.getRequests(method)).length, { timeout: 10_000 })
    .toBe(count);
}

async function proxyReconnect(
  page: Page,
  gateway: MockGatewayControls,
  whileDisconnected: () => Promise<void>,
): Promise<void> {
  const socketCountBefore = await gateway.getSocketCount();
  await gateway.closeLatest(1001, "proxy idle timeout");
  await gateway.setOnline(false);
  await expect
    .poll(() =>
      page.evaluate(() => {
        const app = document.querySelector("openclaw-app") as HTMLElement & {
          runtime?: { context: { gateway: { snapshot: { phase: string } } } };
        };
        return app.runtime?.context.gateway.snapshot.phase;
      }),
    )
    .toBe("reconnecting");
  await whileDisconnected();
  expect(await gateway.getRequests("config.patch")).toHaveLength(0);
  await expect
    .poll(() => gateway.getSocketCount(), { timeout: 10_000 })
    .toBeGreaterThan(socketCountBefore);
  await gateway.setOnline(true);
  await expect
    .poll(() =>
      page.evaluate(() => {
        const app = document.querySelector("openclaw-app") as HTMLElement & {
          runtime?: { context: { gateway: { snapshot: { phase: string } } } };
        };
        return app.runtime?.context.gateway.snapshot.phase;
      }),
    )
    .toBe("connected");
  await page.locator(".settings-page").waitFor({ timeout: 10_000 });
}

async function readSettingsMirror(page: Page): Promise<Record<string, unknown> | null> {
  return page.evaluate(() => {
    const key = Object.keys(localStorage).find((candidate) =>
      candidate.startsWith("openclaw.control.settings.v1:"),
    );
    if (!key) {
      return null;
    }
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as Record<string, unknown>) : null;
  });
}

async function readPendingPrefStorage(page: Page): Promise<Record<string, unknown>[]> {
  return page.evaluate(() =>
    Object.keys(localStorage)
      .filter((key) => key.startsWith("openclaw.control.serverPrefs.pending.v1:"))
      .map((key) => JSON.parse(localStorage.getItem(key) ?? "null") as Record<string, unknown>),
  );
}

function themeModeOption(page: Page, mode: "system" | "light" | "dark") {
  return page.locator(`wa-radio.settings-segmented__btn[value="${mode}"]`);
}

// Sharklet has one theme family (F1-10), so these sync proofs edit the color
// mode where upstream edited the theme family.
async function expectThemeModeActive(page: Page, mode: "system" | "light" | "dark"): Promise<void> {
  await expect
    .poll(
      () => themeModeOption(page, mode).evaluate((radio) => (radio as HTMLInputElement).checked),
      {
        timeout: 10_000,
      },
    )
    .toBe(true);
}

suite.define(() => {
  it.each(["new", "chat"])(
    "keeps %s renders storage-free and applies cross-tab send preferences",
    async (route) => {
      const context = await createContext();
      const page = await context.newPage();
      const gateway = await installMockGateway(page, { agentModel: "openai/gpt-5.6-luna" });
      try {
        await page.goto(`${suite.server.baseUrl}${route}`);
        const selector =
          route === "new"
            ? ".new-session-page__message"
            : ".agent-chat__composer-combobox textarea";
        const textarea = page.locator(selector).first();
        await textarea.waitFor();
        await textarea.fill("Synthetic preference proof");
        const reads = await page.evaluate(async (activeRoute) => {
          const owner = document.querySelector(
            activeRoute === "new" ? "openclaw-new-session-page" : "openclaw-chat-pane",
          ) as HTMLElement & { requestUpdate(): void; updateComplete: Promise<unknown> };
          const descriptor = Object.getOwnPropertyDescriptor(Storage.prototype, "getItem")!;
          const keys: string[] = [];
          Storage.prototype.getItem = function (key) {
            if (/^openclaw\.control\.(settings|currentGateway|token)\./u.test(key)) {
              keys.push(key);
            }
            return Reflect.apply(descriptor.value, this, [key]);
          };
          try {
            for (let index = 0; index < 10; index++) {
              owner.requestUpdate();
              await owner.updateComplete;
            }
            return keys;
          } finally {
            Object.defineProperty(Storage.prototype, "getItem", descriptor);
          }
        }, route);
        expect(reads).toEqual([]);

        const otherTab = await context.newPage();
        // An inert same-origin document produces a real cross-tab storage event,
        // without a second app racing to write server preferences.
        await otherTab.route("**/preference-writer", (request) =>
          request.fulfill({
            contentType: "text/html",
            body: "<!doctype html><title>Preference writer</title>",
          }),
        );
        await otherTab.goto(`${suite.server.baseUrl}preference-writer`);
        await otherTab.evaluate((key) => {
          const current = JSON.parse(localStorage.getItem(key) ?? "{}");
          localStorage.setItem(
            key,
            JSON.stringify({ ...current, chatSendShortcut: "modifier-enter" }),
          );
        }, controlUiBundledSettingsStorageKey(suite.server.baseUrl));
        await expect
          .poll(() =>
            page.evaluate(() => {
              const app = document.querySelector("openclaw-app") as HTMLElement & {
                runtime: { context: { theme: { settings: { chatSendShortcut: string } } } };
              };
              return app.runtime.context.theme.settings.chatSendShortcut;
            }),
          )
          .toBe("modifier-enter");
        await textarea.press("Enter");
        expect(await textarea.inputValue()).toBe("Synthetic preference proof\n");
        expect(await gateway.getRequests("chat.send")).toHaveLength(0);
        expect(await gateway.getRequests("sessions.create")).toHaveLength(0);
      } finally {
        await context.close();
      }
    },
  );

  it("preserves a profile's explicit light theme while reconnecting", async () => {
    const context = await createContext("dark");
    const page = await context.newPage();
    const initial = configResponse({}, "prefs-profile-light-1");
    const gateway = await installMockGateway(page, {
      methodResponses: {
        "config.get": initial,
        "users.prefs.get": {
          entries: { "ui.theme": "claw", "ui.themeMode": "light" },
          status: "ok",
        },
      },
      presenceUsers: [{ id: "profile-theme-light", self: true }],
    });

    try {
      const response = await page.goto(`${suite.server.baseUrl}chat`);
      expect(response?.status()).toBe(200);
      await gateway.waitForRequest("config.get");
      await gateway.waitForRequest("users.prefs.get");
      await gateway.waitForRequest("chat.startup");
      await expect.poll(() => page.locator("html").getAttribute("data-theme-mode")).toBe("light");
      await expect
        .poll(() => page.locator("html").getAttribute("data-theme-resolved"))
        .toBe("light");
      await expect
        .poll(() => readSettingsMirror(page))
        .toMatchObject({ theme: "claw", themeMode: "light" });

      await gateway.setOnline(false);
      await page.locator(".sidebar-footer-bar__status").filter({ hasText: "Offline" }).waitFor();
      await page
        .locator(".agent-chat__composer-status-band")
        .filter({ hasText: "Offline" })
        .waitFor();

      await expect.poll(() => page.locator("html").getAttribute("data-theme-mode")).toBe("light");
      await expect
        .poll(() => page.locator("html").getAttribute("data-theme-resolved"))
        .toBe("light");
      await expect
        .poll(() => readSettingsMirror(page))
        .toMatchObject({ theme: "claw", themeMode: "light" });
    } finally {
      await context.close();
    }
  });

  it("replays an offline color-mode edit after a same-client reconnect", async () => {
    const context = await createContext();
    const page = await context.newPage();
    const initial = configResponse({ themeMode: "system" }, "prefs-a-1");
    const committed = configResponse({ themeMode: "light" }, "prefs-a-2");
    const gateway = await installMockGateway(page, {
      methodResponses: { "config.get": initial },
    });

    try {
      const response = await page.goto(`${suite.server.baseUrl}settings/appearance`);
      expect(response?.status()).toBe(200);
      await themeModeOption(page, "system").waitFor();
      await gateway.waitForRequest("config.get");
      const configGetsBeforeEdit = (await gateway.getRequests("config.get")).length;
      await gateway.deferNext("config.patch");

      await proxyReconnect(page, gateway, async () => {
        await themeModeOption(page, "light").click();
        await expectThemeModeActive(page, "light");
      });

      const patch = await gateway.waitForRequest("config.patch");
      expect(patchPrefs(patch)).toEqual({ themeMode: "light" });
      // Reconnect owns one authoritative read even while the pending LWW preference shadows it.
      await waitForRequestCount(gateway, "config.get", configGetsBeforeEdit + 1);

      await gateway.setMethodResponse("config.get", committed);
      await gateway.resolveDeferred("config.patch", committed);
      await waitForRequestCount(gateway, "config.get", configGetsBeforeEdit + 2);
      await expectThemeModeActive(page, "light");
    } finally {
      await context.close();
    }
  });

  it("keeps offline intent through read-only reconnect and dispatches once after authorization", async () => {
    const context = await createContext();
    const page = await context.newPage();
    const initial = configResponse({ themeMode: "system" }, "prefs-scope-1");
    const committed = configResponse({ themeMode: "light" }, "prefs-scope-2");
    const gateway = await installMockGateway(page, {
      methodResponses: { "config.get": initial },
    });

    try {
      const response = await page.goto(`${suite.server.baseUrl}settings/appearance`);
      expect(response?.status()).toBe(200);
      await themeModeOption(page, "system").waitFor();
      await gateway.waitForRequest("config.get");

      await proxyReconnect(page, gateway, async () => {
        await themeModeOption(page, "light").click();
        await expectThemeModeActive(page, "light");
        await gateway.setOperatorScopes(["operator.read"]);
      });

      await expectThemeModeActive(page, "light");
      expect(await gateway.getRequests("config.patch")).toHaveLength(0);

      await gateway.deferNext("config.patch");
      await gateway.setMethodResponse("config.get", committed);
      await proxyReconnect(page, gateway, async () => {
        await gateway.setOperatorScopes(["operator.admin", "operator.read", "operator.write"]);
      });

      const patch = await gateway.waitForRequest("config.patch");
      expect(patchPrefs(patch)).toEqual({ themeMode: "light" });
      await gateway.resolveDeferred("config.patch", committed);
      await expectThemeModeActive(page, "light");
      await expect
        .poll(async () => (await gateway.getRequests("config.patch")).length, { timeout: 10_000 })
        .toBe(1);
    } finally {
      await context.close();
    }
  });

  it("does not resurrect an offline edit superseded browser-locally in another tab", async () => {
    const context = await createContext();
    const pageA = await context.newPage();
    const pageB = await context.newPage();
    const initial = configResponse({ themeMode: "system" }, "prefs-tabs-1");
    const gatewayA = await installMockGateway(pageA, {
      methodResponses: { "config.get": initial },
    });
    const gatewayB = await installMockGateway(pageB, {
      methodResponses: { "config.get": initial },
    });
    try {
      await Promise.all([
        pageA.goto(`${suite.server.baseUrl}settings/appearance`),
        pageB.goto(`${suite.server.baseUrl}settings/appearance`),
      ]);
      await Promise.all([
        themeModeOption(pageA, "system").waitFor(),
        themeModeOption(pageB, "system").waitFor(),
      ]);
      await Promise.all([
        gatewayA.waitForRequest("config.get"),
        gatewayB.waitForRequest("config.get"),
      ]);

      await proxyReconnect(pageB, gatewayB, async () => {
        await gatewayB.setOperatorScopes(["operator.read"]);
      });

      await proxyReconnect(pageA, gatewayA, async () => {
        await themeModeOption(pageA, "light").click();
        await expectThemeModeActive(pageA, "light");
        expect(await readPendingPrefStorage(pageA)).toEqual([{ themeMode: "light" }]);
        await themeModeOption(pageB, "dark").click();
        await expectThemeModeActive(pageB, "dark");
        expect(await readPendingPrefStorage(pageB)).toEqual([]);
      });
      expect(await readPendingPrefStorage(pageA)).toEqual([]);

      // A disjoint edit must carry only itself: the superseded offline "light"
      // stays gone and B's browser-local "dark" stays local.
      await pageA.locator("[data-settings-follow-up-mode]").selectOption("queue");
      const patch = await gatewayA.waitForRequest("config.patch");
      expect(patchPrefs(patch)).toEqual({ chatFollowUpMode: "queue" });
      expect(await gatewayA.getRequests("config.patch")).toHaveLength(1);
      expect(await gatewayB.getRequests("config.patch")).toHaveLength(0);
      await expectThemeModeActive(pageA, "dark");
      await expectThemeModeActive(pageB, "dark");
    } finally {
      await context.close();
    }
  });

  it("keeps disjoint edits from two pages after both hash-free patches", async () => {
    const contextA = await createContext();
    const contextB = await createContext();
    const pageA = await contextA.newPage();
    const pageB = await contextB.newPage();
    const initial = configResponse({ themeMode: "system" }, "prefs-b-1");
    const gatewayA = await installMockGateway(pageA, {
      methodResponses: { "config.get": initial },
    });
    const gatewayB = await installMockGateway(pageB, {
      methodResponses: { "config.get": initial },
    });

    try {
      await Promise.all([
        pageA.goto(`${suite.server.baseUrl}settings/appearance`),
        pageB.goto(`${suite.server.baseUrl}settings/appearance`),
      ]);
      await Promise.all([
        themeModeOption(pageA, "system").waitFor(),
        themeModeOption(pageB, "system").waitFor(),
      ]);
      await Promise.all([gatewayA.deferNext("config.patch"), gatewayB.deferNext("config.patch")]);

      await themeModeOption(pageA, "light").click();
      const patchA = await gatewayA.waitForRequest("config.patch");
      const prefsA = patchPrefs(patchA);
      expect(prefsA).toEqual({ themeMode: "light" });
      const themeCommitted = configResponse(prefsA, "prefs-b-2");
      await gatewayA.setMethodResponse("config.get", themeCommitted);
      await gatewayA.resolveDeferred("config.patch", themeCommitted);

      await pageB.locator("[data-settings-follow-up-mode]").selectOption("queue");
      const patchB = await gatewayB.waitForRequest("config.patch");
      const prefsB = patchPrefs(patchB);
      expect(prefsB).toEqual({ chatFollowUpMode: "queue" });
      expect(Object.keys(prefsA).some((key) => Object.hasOwn(prefsB, key))).toBe(false);
      const combined = configResponse({ ...prefsA, ...prefsB }, "prefs-b-3");
      await gatewayB.setMethodResponse("config.get", combined);
      await gatewayB.resolveDeferred("config.patch", combined);
      await gatewayA.setMethodResponse("config.get", combined);
      await gatewayA.emitGatewayEvent("config.changed", {
        path: "/tmp/openclaw.json",
        hash: "prefs-b-3",
        ts: Date.now(),
      });

      await expectThemeModeActive(pageA, "light");
      await expectThemeModeActive(pageB, "light");
      await expect
        .poll(() => readSettingsMirror(pageA))
        .toMatchObject({
          chatFollowUpMode: "queue",
          themeMode: "light",
        });
      await expect
        .poll(() => readSettingsMirror(pageB))
        .toMatchObject({
          chatFollowUpMode: "queue",
          themeMode: "light",
        });
    } finally {
      await contextA.close();
      await contextB.close();
    }
  });

  it("applies a server delta without reverting a pending local key", async () => {
    const context = await createContext();
    const page = await context.newPage();
    const initial = configResponse({ locale: "en", themeMode: "system" }, "prefs-c-1");
    const gateway = await installMockGateway(page, {
      methodResponses: { "config.get": initial },
    });

    try {
      await page.goto(`${suite.server.baseUrl}settings/appearance`);
      await themeModeOption(page, "system").waitFor();
      await gateway.waitForRequest("config.get");
      const initialConfigGets = (await gateway.getRequests("config.get")).length;
      await gateway.deferNext("config.patch");

      await themeModeOption(page, "light").click();
      const patch = await gateway.waitForRequest("config.patch");
      expect(patchPrefs(patch)).toEqual({ themeMode: "light" });

      const serverChanged = configResponse({ locale: "de", themeMode: "system" }, "prefs-c-2");
      await gateway.setMethodResponse("config.get", serverChanged);
      await gateway.emitGatewayEvent("config.changed", {
        path: "/tmp/openclaw.json",
        hash: "prefs-c-2",
        ts: Date.now(),
      });
      await waitForRequestCount(gateway, "config.get", initialConfigGets + 1);

      await expectThemeModeActive(page, "light");
      await expect
        .poll(() => readSettingsMirror(page))
        .toMatchObject({
          locale: "de",
          themeMode: "light",
        });

      await gateway.rejectDeferred("config.patch", {
        code: "INVALID_REQUEST",
        message: "mock validation failure",
      });
      await expectThemeModeActive(page, "light");
    } finally {
      await context.close();
    }
  });
});

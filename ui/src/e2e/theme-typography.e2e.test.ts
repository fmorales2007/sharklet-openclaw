import { mkdir } from "node:fs/promises";
import path from "node:path";
import { expect, it } from "vitest";
import {
  controlUiBundledGatewayUrl,
  installMockGateway,
  type ControlUiMockGatewayScenario,
  waitForControlUiRoute,
} from "../test-helpers/control-ui-e2e.ts";
import { createControlUiE2eSuite } from "./control-ui-e2e-suite.test-support.ts";

/*
 * Sharklet's faces (Geist for chrome and chat, Geist Mono for code) must
 * actually paint. That is invisible to unit tests: the stylesheet is linked at
 * runtime and the faces only resolve once the browser has fetched them, so a
 * broken asset path or a dropped link degrades silently to the fallback stack
 * and looks merely "a bit off". Upstream's per-family typeface and palette
 * cases left with its themes (F1-10).
 */

const captureUiProof = process.env.OPENCLAW_CAPTURE_UI_PROOF === "1";

// Every pair JetBrains Mono ligates, each closed by the trailing space that
// triggers the corruption reported in issue #137473.
const suite = createControlUiE2eSuite({
  name: "Control UI theme typography",
  trackBrowserContexts: true,
  unavailableMessage: (executablePath) =>
    `Playwright Chromium is required for theme typography proof at ${executablePath}`,
});

function themeConfigResponse(theme: string, mode: "dark" | "light") {
  const config = { ui: { prefs: { theme, themeMode: mode } } };
  const hash = `theme-typography-${theme}-${mode}`;
  return {
    appliedConfigHash: hash,
    config,
    configRevisionHash: hash,
    hash,
    issues: [],
    raw: JSON.stringify(config),
    valid: true,
  };
}

async function openThemedChat(
  theme: string,
  mode: "dark" | "light",
  scenario: Pick<
    ControlUiMockGatewayScenario,
    "basePath" | "featureMethods" | "historyMessages" | "methodResponses"
  > = {},
) {
  const context = await suite.newBrowserContext({
    colorScheme: mode,
    locale: "en-US",
    serviceWorkers: "block",
    viewport: { height: 900, width: 1440 },
  });
  await context.addInitScript(
    ({ gatewayUrl, initialMode, initialTheme }) => {
      if (sessionStorage.getItem("typography-seeded")) {
        return;
      }
      sessionStorage.setItem("typography-seeded", "1");
      localStorage.setItem(
        `openclaw.control.settings.v1:${gatewayUrl}`,
        JSON.stringify({ gatewayUrl, theme: initialTheme, themeMode: initialMode }),
      );
    },
    {
      gatewayUrl: controlUiBundledGatewayUrl(suite.server.baseUrl),
      initialMode: mode,
      initialTheme: theme,
    },
  );
  const page = await context.newPage();
  const themeRequests: string[] = [];
  page.on("response", (response) => {
    const { pathname } = new URL(response.url());
    if (pathname.includes("/fonts/")) {
      themeRequests.push(`${pathname.split("/").pop()} ${response.status()}`);
    }
  });
  const gateway = await installMockGateway(page, {
    ...scenario,
    methodResponses: {
      ...scenario.methodResponses,
      "config.get": themeConfigResponse(theme, mode),
    },
  });
  return { themeRequests, gateway, page };
}

async function captureTypography(
  page: Awaited<ReturnType<typeof openThemedChat>>["page"],
  name: string,
) {
  if (captureUiProof) {
    await mkdir(path.join(suite.artifactDir, "theme-typography"), { recursive: true });
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({
      path: path.join(path.join(suite.artifactDir, "theme-typography"), `${name}.png`),
    });
  }
}

suite.define(() => {
  it("paints chrome and chat prose in Geist and code in Geist Mono", async () => {
    const timestamp = Date.now();
    const text =
      "Typography carries the theme: chat prose renders in the reading face while chrome, chips, and code keep their own: `const example = 1`.";
    const { themeRequests, page } = await openThemedChat("claw", "dark", {
      historyMessages: [
        {
          content: [{ text: "say something", type: "text" }],
          role: "user",
          timestamp: timestamp - 1,
        },
        {
          content: [{ text, type: "text" }],
          role: "assistant",
          timestamp,
        },
      ],
    });
    await page.goto(`${suite.server.baseUrl}chat`);
    await expect
      .poll(() => page.locator(".chat-text").last().textContent())
      .toContain("Typography");
    await page.locator(".chat-text code").waitFor({ state: "visible" });

    const report = await page.evaluate(async () => {
      await document.fonts.ready;
      const chats = document.querySelectorAll(".chat-text");
      const lastChat = chats[chats.length - 1];
      const primary = (value: string) =>
        (value.split(",")[0] ?? "").trim().replace(/^["']|["']$/gu, "");
      return {
        buildId: document.documentElement.getAttribute("data-openclaw-control-ui-build-id"),
        chatFontFamily: lastChat ? primary(getComputedStyle(lastChat).fontFamily) : null,
        codeFontFamily: lastChat?.querySelector("code")
          ? primary(getComputedStyle(lastChat.querySelector("code")!).fontFamily)
          : null,
        chatFontSmoothing: lastChat
          ? getComputedStyle(lastChat).getPropertyValue("-webkit-font-smoothing")
          : null,
        bodyFontFamily: primary(getComputedStyle(document.body).fontFamily),
        stylesheets: [
          ...document.querySelectorAll<HTMLLinkElement>('link[id^="sharklet-font-"]'),
        ].map((link) => {
          const url = new URL(link.href);
          return { pathname: url.pathname, version: url.searchParams.get("v") };
        }),
        loaded: [...document.fonts].filter((f) => f.status === "loaded").map((f) => f.family),
      };
    });

    if (report.buildId !== null) {
      expect(report.buildId).not.toBe("");
    }
    expect(report.stylesheets).toEqual(
      ["geist", "geist-mono"].map((face) => ({
        pathname: `/fonts/${face}.css`,
        version: report.buildId,
      })),
    );
    expect(report.bodyFontFamily).toBe("Geist");
    expect(report.chatFontFamily).toBe("Geist");
    expect(report.codeFontFamily).toBe("Geist Mono");
    expect(report.chatFontSmoothing).toBe("antialiased");
    expect(new Set(report.loaded)).toEqual(new Set(["Geist", "Geist Mono"]));
    expect(themeRequests.every((entry) => entry.endsWith(" 200"))).toBe(true);

    await captureTypography(page, "sharklet-chat-dark");
  });

  it("keeps system chrome with the mounted route across shell and viewport lifecycles", async () => {
    const { page } = await openThemedChat("claw", "light");
    await page.setViewportSize({ width: 720, height: 900 });
    await page.goto(`${suite.server.baseUrl}chat`);
    await page.locator(".agent-chat__composer-combobox textarea").waitFor();

    const readChrome = () =>
      page.evaluate(() => ({
        color: document.documentElement.style.getPropertyValue(
          "--control-ui-system-chrome-background",
        ),
        metas: Array.from(
          document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]'),
          (meta) => ({ color: meta.content, media: meta.getAttribute("media") }),
        ),
      }));
    const expectChrome = async (color: string) => {
      await expect.poll(readChrome).toEqual({
        color,
        metas: [
          { color, media: null },
          { color, media: null },
        ],
      });
    };
    // Sharklet's light --sk-canvas, and --sk-surface behind the narrow chat.
    const pageColor = "#f5f7f9";
    const chatColor = "#fdfeff";
    await expectChrome(chatColor);

    // Use the shell's actual shortcut and browser history without rebuilding the runtime.
    await page.locator(".shell-skip-link").focus();
    await page.keyboard.press("ControlOrMeta+Shift+,");
    await waitForControlUiRoute(page, { pathname: "/settings/appearance", routeId: "appearance" });
    await expectChrome(pageColor);
    await page.goBack();
    await page.locator(".agent-chat__composer-combobox textarea").waitFor();
    await expectChrome(chatColor);
    await page.locator(".chat-pane__nav-toggle").first().click();
    await page.locator("openclaw-app-sidebar .sidebar-brand__new-thread").click();
    await page.locator(".new-session-page__message").waitFor();
    await expectChrome(chatColor);

    for (const [width, height, color] of [
      [1280, 900, pageColor],
      [900, 450, chatColor],
      [900, 900, pageColor],
      [720, 900, chatColor],
    ] as const) {
      await page.setViewportSize({ width, height });
      await expectChrome(color);
    }

    // Runtime removal renders nothing; restoration must rebind the existing router.
    const runtimeLifecycle = await page.locator("openclaw-app-shell").evaluate(async (element) => {
      const shell = element as HTMLElement & {
        runtime?: import("../app/bootstrap.ts").ApplicationRuntime;
        updateComplete: Promise<boolean>;
      };
      const runtime = shell.runtime;
      const color = () =>
        document.documentElement.style.getPropertyValue("--control-ui-system-chrome-background");
      try {
        shell.runtime = undefined;
        await shell.updateComplete;
        const removed = { color: color(), chat: Boolean(shell.querySelector(".shell--chat")) };
        shell.runtime = runtime;
        await shell.updateComplete;
        return {
          removed,
          restored: { color: color(), chat: Boolean(shell.querySelector(".shell--chat")) },
        };
      } finally {
        shell.runtime = runtime;
      }
    });
    expect(runtimeLifecycle).toEqual({
      removed: { color: pageColor, chat: false },
      restored: { color: chatColor, chat: true },
    });
    await expectChrome(chatColor);

    const reconnect = await page.locator("openclaw-app-shell").evaluate(async (element) => {
      const shell = element as HTMLElement & { updateComplete: Promise<boolean> };
      const parent = shell.parentNode!;
      const next = shell.nextSibling;
      const color = () =>
        document.documentElement.style.getPropertyValue("--control-ui-system-chrome-background");
      try {
        shell.remove();
        const removed = color();
        parent.insertBefore(shell, next);
        await shell.updateComplete;
        return {
          removed,
          reconnected: color(),
          sameShell: document.querySelector("openclaw-app-shell") === shell,
        };
      } finally {
        if (!shell.isConnected) {
          parent.insertBefore(shell, next);
        }
      }
    });
    expect(reconnect).toEqual({ removed: pageColor, reconnected: chatColor, sameShell: true });
    await expectChrome(chatColor);
  });

  it("resolves the font stylesheet against a configured mount path", async () => {
    // A gateway mounted at a base path serves the bundle below that prefix, so
    // root-absolute font URLs 404 there and the app silently falls back to
    // system faces.
    const basePath = "/openclaw";
    const { page } = await openThemedChat("claw", "dark", { basePath });
    const requested: string[] = [];
    // The preview server does not stamp Gateway HTML. Reproduce the actual
    // document contract, rather than letting runtime repair a wrong boot URL.
    await page.route("**/*", async (route) => {
      if (
        route.request().resourceType() !== "document" ||
        !new URL(route.request().url()).pathname.startsWith(`${basePath}/`)
      ) {
        await route.fallback();
        return;
      }
      const response = await route.fetch();
      const html = (await response.text()).replace(
        /<html\b/u,
        `<html data-openclaw-control-ui-base-path="${basePath}"`,
      );
      await route.fulfill({ response, body: html });
    });
    await page.route(`**${basePath}/fonts/**`, async (route) => {
      const { pathname } = new URL(route.request().url());
      requested.push(pathname);
      await route.fulfill({ status: 404, body: "", contentType: "text/css" });
    });

    await page.goto(`${suite.server.baseUrl}${basePath.slice(1)}/chat`);
    await page
      .locator(".agent-chat__composer-combobox textarea")
      .waitFor({ state: "visible", timeout: 30_000 });

    const linkHref = await page.evaluate(
      () => document.getElementById("sharklet-font-fonts-geist-css")?.getAttribute("href") ?? null,
    );

    const buildId = await page.locator("html").getAttribute("data-openclaw-control-ui-build-id");
    if (buildId !== null) {
      expect(buildId).not.toBe("");
    }
    const fontUrl = new URL(linkHref ?? "", suite.server.baseUrl);
    expect(fontUrl.pathname).toBe(`${basePath}/fonts/geist.css`);
    expect(fontUrl.searchParams.get("v")).toBe(buildId);
    // The browser must actually fetch below the mount, not at the root.
    await expect.poll(() => requested).toContain(`${basePath}/fonts/geist.css`);
  });
});

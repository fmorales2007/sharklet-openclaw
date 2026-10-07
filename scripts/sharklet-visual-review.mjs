#!/usr/bin/env node
// Sharklet visual review: phase 1 step 1's "review both themes and both
// densities, at 390px and 1440px, with the keyboard and with reduced motion",
// done by a browser instead of by eye, so it can be repeated after every change.
//
// Usage:
//   node scripts/sharklet-visual-review.mjs [url] [--out dir]
//   url defaults to the dev server, http://127.0.0.1:5173/
//
// For each mode (light, dark) x density (comfortable, compact) x width (390,
// 1440) it loads the app the way a person on the default "system" appearance
// gets each mode — by the OS color scheme, which index.html and bootstrap-theme
// both follow — screenshots it, and checks what the bridge is supposed to
// guarantee, plus step 2's shell: English on a Spanish browser, the help
// button, no Discord card or lobster. Then, once per mode: keyboard focus,
// reduced motion, and the surfaces Web Awesome only draws on demand (the three
// sidebar menus, Settings → Appearance with its select open, the Plugins hub),
// scanned for OpenClaw's coral and Web Awesome's own blue, and the density
// switch in the profile menu. And once per mode, a live color-mode switch in
// Settings → Appearance, re-checked after each change.
//
// Exit code 1 if any check fails. Screenshots and report.json go to --out
// (default .artifacts/sharklet-visual-review/).

import { mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const { chromium } = createRequire(join(root, "ui", "package.json"))("playwright");

const args = process.argv.slice(2);
const outFlag = args.indexOf("--out");
const outDir = resolve(
  outFlag >= 0 ? args[outFlag + 1] : join(root, ".artifacts", "sharklet-visual-review"),
);
const url =
  args.find((arg, index) => !arg.startsWith("--") && args[index - 1] !== "--out") ??
  "http://127.0.0.1:5173/";

// The approved values (docs/design-system/tokens.css), per mode.
const EXPECT = {
  light: { bg: "#f5f7f9", accent: "#006e98", text: "#171b21" },
  dark: { bg: "#0c0f16", accent: "#58bfe6", text: "#eef0f4" },
};
const DENSITY_UI_PX = { comfortable: 14, compact: 13 };
const WIDTHS = [390, 1440];

mkdirSync(outDir, { recursive: true });
const report = { url, startedAt: new Date().toISOString(), runs: [], failures: [] };

// Runs in the page. Foreign accents painted anywhere, shadow roots included:
// OpenClaw's coral, and Web Awesome's own blue — read from its brand scale on
// :root, so it is whatever the installed theme resolves, not a list typed
// here. A hit means something the bridge does not reach.
function scanPainted() {
  const probe = document.createElement("span");
  document.body.append(probe);
  const rgbOf = (value) => {
    probe.style.color = "";
    probe.style.color = value;
    return getComputedStyle(probe).color.match(/\d+/g)?.slice(0, 3).join(",");
  };
  const rootStyle = getComputedStyle(document.documentElement);
  const waBlue = new Set(
    ["05", "10", "20", "30", "40", "50", "60", "70", "80", "90", "95"]
      .map((step) => rootStyle.getPropertyValue(`--wa-color-brand-${step}`).trim())
      .filter(Boolean)
      .map(rgbOf),
  );
  probe.remove();
  const coral = new Set(["255,92,92", "255,112,112", "209,60,60", "194,46,46"]);
  const hits = { coral: [], waBlue: [], waBlueSteps: waBlue.size };
  const visit = (scope) => {
    for (const el of scope.querySelectorAll("*")) {
      const style = getComputedStyle(el);
      for (const prop of [
        "color",
        "backgroundColor",
        "borderTopColor",
        "outlineColor",
        "fill",
        "stroke",
      ]) {
        const rgb = style[prop]?.match(/\d+/g)?.slice(0, 3).join(",");
        const where = `${el.tagName.toLowerCase()}.${String(el.className?.baseVal ?? el.className ?? "").split(" ")[0]} ${prop}`;
        if (rgb && coral.has(rgb) && hits.coral.length < 5) {
          hits.coral.push(where);
        }
        if (rgb && waBlue.has(rgb) && hits.waBlue.length < 5) {
          hits.waBlue.push(where);
        }
      }
      if (el.shadowRoot) {
        visit(el.shadowRoot);
      }
    }
  };
  visit(document);
  return hits;
}

function checkPainted(run, where, hits) {
  check(
    run,
    `no OpenClaw coral painted${where}`,
    hits.coral.length === 0,
    hits.coral.join(", ") || "none",
  );
  check(
    run,
    `no Web Awesome blue painted${where}`,
    hits.waBlueSteps > 0 && hits.waBlue.length === 0,
    hits.waBlueSteps > 0 ? hits.waBlue.join(", ") || "none" : "brand scale not found on :root",
  );
}

function check(run, name, ok, detail) {
  run.checks.push({ name, ok, detail });
  if (!ok) {
    report.failures.push(`${run.id}: ${name} (${detail})`);
  }
}

async function openApp(browser, { mode, density, width, reducedMotion = false }) {
  const context = await browser.newContext({
    viewport: { width, height: width < 760 ? 844 : 900 },
    deviceScaleFactor: width < 760 ? 2 : 1,
    reducedMotion: reducedMotion ? "reduce" : "no-preference",
    // The default appearance is "system", so the OS scheme is the real path to
    // each mode. Faking the persisted settings instead does not survive boot:
    // the app keeps them under a per-gateway key and re-stamps the mode.
    colorScheme: mode,
    // The owner's browser language. The UI must come up in English anyway
    // (custom/locale.ts and shell.ts).
    locale: "es-CL",
  });
  // Density the way the profile menu's switch stores it (custom/shell.ts), so
  // the startup path that reads it back is what gets tested.
  await context.addInitScript((value) => {
    try {
      if (value === "compact") {
        localStorage.setItem("sharklet.density", "compact");
      }
    } catch {
      // about:blank has no storage; the app's own origin does.
    }
  }, density);
  const page = await context.newPage();
  const consoleErrors = [];
  const pageErrors = [];
  const failedRequests = [];
  page.on("console", (message) => message.type() === "error" && consoleErrors.push(message.text()));
  page.on("pageerror", (error) => pageErrors.push(String(error)));
  page.on("response", (response) => {
    if (response.status() >= 400) {
      failedRequests.push(
        `${response.status()} ${decodeURIComponent(response.url()).replace(/^.*\.ts\.net/, "")}`,
      );
    }
  });
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page
    .waitForFunction(
      () =>
        document.querySelector("openclaw-app")?.shadowRoot ||
        document.querySelector("openclaw-app")?.children.length,
      null,
      { timeout: 30_000 },
    )
    .catch(() => {});
  await page.waitForTimeout(4_000);
  // Home (Mission Control) loads its strip after the shell: wait for it, so the
  // checks and screenshots below see the page and not its skeleton.
  if (new URL(page.url()).pathname === "/home") {
    await page
      .locator("sharklet-mission-strip .sk-strip-row")
      .waitFor({ timeout: 20_000 })
      .catch(() => {});
  }
  return { context, page, consoleErrors, pageErrors, failedRequests };
}

const browser = await chromium.launch();
try {
  for (const mode of ["light", "dark"]) {
    for (const density of ["comfortable", "compact"]) {
      for (const width of WIDTHS) {
        const id = `${mode}-${density}-${width}`;
        const run = { id, checks: [] };
        report.runs.push(run);
        const app = await openApp(browser, { mode, density, width });
        const state = await app.page.evaluate(() => {
          const html = document.documentElement;
          const css = getComputedStyle(html);
          const probe = document.createElement("span");
          probe.style.fontSize = "var(--sk-fs-ui)";
          document.body.append(probe);
          const uiPx = Number.parseFloat(getComputedStyle(probe).fontSize);
          probe.remove();
          return {
            themeMode: html.dataset.themeMode,
            density: html.dataset.density,
            bg: css.getPropertyValue("--bg").trim(),
            accent: css.getPropertyValue("--accent").trim(),
            text: css.getPropertyValue("--text").trim(),
            bodyFont: getComputedStyle(document.body).fontFamily,
            uiPx,
            title: document.title,
            mascotIsOurs: customElements.get("openclaw-mascot")?.name === "SharkletMascot",
            horizontalOverflow: document.documentElement.scrollWidth > window.innerWidth + 1,
            // upstream's "Styles failed to load" banner: a role=alert div appended
            // to <body>, as opposed to the hidden boot-error <section>.
            stylesBanner: [...document.body.children].some(
              (el) =>
                el.tagName === "DIV" &&
                el.getAttribute("role") === "alert" &&
                el.offsetParent !== null,
            ),
            lang: html.lang,
            askOpenClaw: document.body.textContent.includes("Ask OpenClaw"),
            helpButton: (() => {
              const button = document.querySelector(".sk-help-btn");
              return button ? getComputedStyle(button).display !== "none" : null;
            })(),
            inviteShown: [...document.querySelectorAll(".sidebar-shell__invite")].some(
              (el) => el.offsetParent !== null,
            ),
            onHome: location.pathname === "/home",
            missionStrip: Boolean(document.querySelector("sharklet-mission-strip .sk-strip-row")),
            // The narrow top bar names the app on phones (app-topbar.ts).
            topbarBrand: (() => {
              const title = document.querySelector(".topbar-brand__title");
              return title && title.offsetParent !== null ? title.textContent.trim() : null;
            })(),
          };
        });
        const painted = await app.page.evaluate(scanPainted);
        check(run, "theme mode stamped", state.themeMode === mode, state.themeMode);
        check(run, "--bg is Sharklet canvas", state.bg === EXPECT[mode].bg, state.bg);
        check(
          run,
          "--accent is Sharklet ocean",
          state.accent === EXPECT[mode].accent,
          state.accent,
        );
        check(run, "--text is Sharklet ink", state.text === EXPECT[mode].text, state.text);
        check(run, "body font is Geist", /^"?Geist"?,/.test(state.bodyFont), state.bodyFont);
        check(
          run,
          `--sk-fs-ui is ${DENSITY_UI_PX[density]}px`,
          state.uiPx === DENSITY_UI_PX[density],
          `${state.uiPx}px, data-density=${state.density}`,
        );
        check(run, "title names Sharklet", /Sharklet/.test(state.title), state.title);
        check(
          run,
          "the phone top bar names Sharklet",
          state.topbarBrand === null || state.topbarBrand === "Sharklet",
          String(state.topbarBrand),
        );
        if (state.onHome) {
          check(
            run,
            "Home shows Mission Control's strip",
            state.missionStrip,
            String(state.missionStrip),
          );
        }
        check(run, "mascot element is Sharklet's", state.mascotIsOurs, String(state.mascotIsOurs));
        check(
          run,
          "no horizontal page scroll",
          !state.horizontalOverflow,
          String(state.horizontalOverflow),
        );
        check(
          run,
          "no uncaught page errors",
          app.pageErrors.length === 0,
          app.pageErrors.join(" | ").slice(0, 300),
        );
        check(
          run,
          "no 'Styles failed to load' banner",
          !state.stylesBanner,
          String(state.stylesBanner),
        );
        checkPainted(run, "", painted);
        check(run, "English on an es-CL browser", state.lang === "en", state.lang);
        check(run, "no 'Ask OpenClaw' on screen", !state.askOpenClaw, String(state.askOpenClaw));
        // theme/shell.css: shown from 1160px, where the composer leaves the
        // corner free; narrower screens reach Help through upstream's panels.
        check(
          run,
          `help button ${width >= 1160 ? "shown" : "hidden"}`,
          state.helpButton === width >= 1160,
          String(state.helpButton),
        );
        check(run, "no Discord card or lobster pet", !state.inviteShown, String(state.inviteShown));
        // Our own assets that 404 are warnings, not failures: against a gateway
        // that still runs an older build, anything new is legitimately missing
        // until the next deploy.
        run.warnings = app.failedRequests.filter((line) =>
          /\/(fonts|custom|icon-|favicon|apple-touch)/.test(line),
        );
        run.consoleErrors = app.consoleErrors;
        run.failedRequests = app.failedRequests;
        await app.page.screenshot({ path: join(outDir, `${id}.png`) });
        await app.context.close();
      }
    }

    // Keyboard, once per mode: every stop the Tab key reaches must show a ring.
    {
      const run = { id: `${mode}-keyboard`, checks: [] };
      report.runs.push(run);
      const app = await openApp(browser, { mode, density: "comfortable", width: 1440 });
      const stops = [];
      for (let index = 0; index < 8; index += 1) {
        await app.page.keyboard.press("Tab");
        stops.push(
          await app.page.evaluate(() => {
            let el = document.activeElement;
            while (el?.shadowRoot?.activeElement) {
              el = el.shadowRoot.activeElement;
            }
            if (!el || el === document.body) {
              return null;
            }
            const style = getComputedStyle(el);
            const outline =
              style.outlineStyle !== "none" && Number.parseFloat(style.outlineWidth) > 0;
            const shadow = style.boxShadow !== "none";
            return {
              tag: el.tagName.toLowerCase(),
              label: (el.getAttribute("aria-label") || el.textContent || "").trim().slice(0, 30),
              visible: outline || shadow,
            };
          }),
        );
      }
      const reached = stops.filter(Boolean);
      check(run, "Tab reaches focusable controls", reached.length > 0, `${reached.length} stops`);
      const invisible = reached.filter((stop) => !stop.visible);
      check(
        run,
        "every focused control shows a ring",
        invisible.length === 0,
        invisible.map((stop) => `${stop.tag} "${stop.label}"`).join(", ") || "all visible",
      );
      run.stops = reached;
      await app.page.screenshot({ path: join(outDir, `${mode}-keyboard.png`) });
      await app.context.close();
    }

    // Surfaces Web Awesome only draws on demand, once per mode: the three
    // sidebar menus (wa-dropdown), Appearance with its wa-select open (plus its
    // wa-switches), and the Plugins hub (wa-tab-group). Plus the density switch,
    // while the profile menu is open.
    {
      const run = { id: `${mode}-surfaces`, checks: [] };
      report.runs.push(run);
      const app = await openApp(browser, { mode, density: "comfortable", width: 1440 });
      const { page } = app;
      for (const [name, trigger] of [
        ["profile menu", ".sidebar-identity-card"],
        ["agent menu", ".sidebar-agent-card__main"],
        ["pages menu", ".sidebar-nav__head-action"],
      ]) {
        await page.click(trigger);
        await page.waitForTimeout(800);
        checkPainted(run, `: ${name}`, await page.evaluate(scanPainted));
        if (name === "profile menu") {
          await page.click('.sidebar-identity-menu__footer button[aria-label^="Density"]');
          const after = await page.evaluate(() => ({
            density: document.documentElement.dataset.density ?? "comfortable",
            stored: localStorage.getItem("sharklet.density"),
          }));
          check(
            run,
            "density switch sets compact and stores it",
            after.density === "compact" && after.stored === "compact",
            JSON.stringify(after),
          );
          await page.screenshot({ path: join(outDir, `${mode}-profile-menu.png`) });
        }
        await page.keyboard.press("Escape");
        await page.waitForTimeout(400);
      }
      for (const path of ["settings/appearance", "plugins"]) {
        await page.goto(new URL(path, url).href, { waitUntil: "domcontentloaded" });
        await page.waitForTimeout(4_000);
        await page.evaluate(() => {
          const select = document.querySelector("wa-select");
          if (select) {
            select.open = true;
          }
        });
        await page.waitForTimeout(600);
        checkPainted(run, `: /${path}`, await page.evaluate(scanPainted));
      }
      await page.screenshot({ path: join(outDir, `${mode}-appearance-plugins.png`) });
      await app.context.close();
    }

    // Theme switch, once per mode: flip the color mode live in Settings →
    // Appearance (no reload), then back to System. Each state must still be
    // Sharklet's palette, with nothing upstream re-entering the cascade: no
    // palette sheet, no tweakcn <style>, no inline accent or typeface.
    {
      const run = { id: `${mode}-theme-switch`, checks: [] };
      report.runs.push(run);
      const app = await openApp(browser, { mode, density: "comfortable", width: 1440 });
      const { page } = app;
      await page.goto(new URL("settings/appearance", url).href, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(4_000);
      const other = mode === "light" ? "dark" : "light";
      const colorMode = page.locator("#settings-appearance-theme");
      try {
        for (const [label, expected] of [
          [other === "light" ? "Light" : "Dark", other],
          ["System", mode],
        ]) {
          await colorMode.getByText(label, { exact: true }).click();
          await page.waitForTimeout(800);
          const after = await page.evaluate(() => {
            const html = document.documentElement;
            const css = getComputedStyle(html);
            return {
              themeMode: html.dataset.themeMode,
              bg: css.getPropertyValue("--bg").trim(),
              accent: css.getPropertyValue("--accent").trim(),
              text: css.getPropertyValue("--text").trim(),
              inline: ["--accent", "--primary", "--ring", "--font-body", "--font-chat"].filter(
                (name) => html.style.getPropertyValue(name),
              ),
              competitors: [
                ...document.querySelectorAll(
                  'link[id^="openclaw-theme-palette-"], #openclaw-custom-theme',
                ),
              ].map((el) => el.id),
            };
          });
          const where = ` after ${label}`;
          check(
            run,
            `theme mode is ${expected}${where}`,
            after.themeMode === expected,
            after.themeMode,
          );
          check(run, `--bg is Sharklet canvas${where}`, after.bg === EXPECT[expected].bg, after.bg);
          check(
            run,
            `--accent is Sharklet ocean${where}`,
            after.accent === EXPECT[expected].accent,
            after.accent,
          );
          check(
            run,
            `--text is Sharklet ink${where}`,
            after.text === EXPECT[expected].text,
            after.text,
          );
          check(
            run,
            `no inline palette or typeface on <html>${where}`,
            after.inline.length === 0,
            after.inline.join(", ") || "none",
          );
          check(
            run,
            `no upstream palette sheet or tweakcn style${where}`,
            after.competitors.length === 0,
            after.competitors.join(", ") || "none",
          );
          checkPainted(run, where, await page.evaluate(scanPainted));
          await page.screenshot({
            path: join(outDir, `${mode}-theme-switch-${label.toLowerCase()}.png`),
          });
        }
      } finally {
        // Against a real gateway the color mode is a synced profile preference:
        // leave it on System (the default this script runs under) even when a
        // check above threw halfway.
        await colorMode
          .getByText("System", { exact: true })
          .click()
          .catch(() => {});
        await page.waitForTimeout(800);
        await app.context.close();
      }
    }

    // Reduced motion, once per mode: CSS cannot stop SMIL, so motion.js must.
    {
      const run = { id: `${mode}-reduced-motion`, checks: [] };
      report.runs.push(run);
      const app = await openApp(browser, {
        mode,
        density: "comfortable",
        width: 1440,
        reducedMotion: true,
      });
      const paused = await app.page.evaluate(async () => {
        const mascot = document.createElement("openclaw-mascot");
        mascot.mood = "thinking";
        document.body.append(mascot);
        const deadline = Date.now() + 5_000;
        while (!mascot.querySelector("animate") && Date.now() < deadline) {
          await new Promise((resolveWait) => {
            setTimeout(resolveWait, 100);
          });
        }
        await new Promise((resolveWait) => {
          setTimeout(resolveWait, 300);
        });
        const svg = mascot.querySelector("svg");
        const result = {
          swimLoaded: Boolean(mascot.querySelector("animate")),
          paused: svg?.animationsPaused?.() ?? null,
        };
        mascot.remove();
        return result;
      });
      check(
        run,
        "swim art loads for a thinking mascot",
        paused.swimLoaded,
        String(paused.swimLoaded),
      );
      check(
        run,
        "SMIL swim is paused under reduced motion",
        paused.paused === true,
        String(paused.paused),
      );
      await app.context.close();
    }
  }
} finally {
  await browser.close();
}

report.finishedAt = new Date().toISOString();
writeFileSync(join(outDir, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
const total = report.runs.reduce((sum, run) => sum + run.checks.length, 0);
console.log(
  `${total - report.failures.length}/${total} checks passed across ${report.runs.length} runs; screenshots in ${outDir}`,
);
for (const failure of report.failures) {
  console.log(`FAIL ${failure}`);
}
const warnings = [
  ...new Set(report.runs.flatMap((run) => run.warnings ?? []).map((line) => line.split("?")[0])),
];
for (const warning of warnings) {
  console.log(`WARN own asset not served (older build on the gateway?): ${warning}`);
}
process.exitCode = report.failures.length ? 1 : 0;

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
// guarantee. Then it checks keyboard focus and reduced motion once per mode.
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
    locale: "en-US",
  });
  // Density has no control until step 2; this is the attribute it will set.
  // An init script, not a one-off evaluate: it has to survive the reloads the
  // app may do while booting, and <html> does not exist yet when it first runs.
  await context.addInitScript((value) => {
    const apply = () => {
      if (!document.documentElement) {
        return false;
      }
      document.documentElement.dataset.density = value;
      return true;
    };
    if (!apply()) {
      new MutationObserver((_records, observer) => {
        if (apply()) {
          observer.disconnect();
        }
      }).observe(document, { childList: true });
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
            // OpenClaw's accent family, anywhere it is painted, including inside
            // shadow roots. A hit means something the bridge does not reach.
            upstreamAccent: (() => {
              const signature = new Set(["255,92,92", "255,112,112", "209,60,60", "194,46,46"]);
              const found = [];
              const visit = (scope) => {
                for (const el of scope.querySelectorAll("*")) {
                  const style = getComputedStyle(el);
                  for (const prop of [
                    "color",
                    "backgroundColor",
                    "borderTopColor",
                    "outlineColor",
                  ]) {
                    const rgb = style[prop].match(/\d+/g)?.slice(0, 3).join(",");
                    if (rgb && signature.has(rgb) && found.length < 5) {
                      found.push(
                        `${el.tagName.toLowerCase()}.${String(el.className?.baseVal ?? el.className ?? "").split(" ")[0]} ${prop}`,
                      );
                    }
                  }
                  if (el.shadowRoot) {
                    visit(el.shadowRoot);
                  }
                }
              };
              visit(document);
              return found;
            })(),
          };
        });
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
        check(
          run,
          "no OpenClaw accent color painted",
          state.upstreamAccent.length === 0,
          state.upstreamAccent.join(", ") || "none",
        );
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

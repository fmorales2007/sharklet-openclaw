import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { expect, it } from "vitest";
import { installMockGateway } from "../test-helpers/control-ui-e2e.ts";
import { resolveRenderedColors, type RenderedColor } from "../test-helpers/rendered-colors.ts";
import { createControlUiE2eSuite } from "./control-ui-e2e-suite.test-support.ts";

const captureUiProof = process.env.OPENCLAW_CAPTURE_UI_PROOF === "1";

// Sharklet ships one theme family (F1-10); its two modes are the cases.
const themeCases = [{ mode: "dark" }, { mode: "light" }] as const;

const textTokens = [
  "--text",
  "--text-strong",
  "--chat-text",
  "--muted",
  "--muted-strong",
  "--muted-foreground",
] as const;

const surfaceTokens = ["--bg", "--bg-elevated", "--bg-muted", "--card", "--panel"] as const;

function themeConfigResponse(mode: "dark" | "light") {
  const config = {
    ui: { prefs: { themeMode: mode } },
  };
  const hash = `theme-contrast-${mode}`;
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

function compositeColor(foreground: RenderedColor, background: RenderedColor): RenderedColor {
  if (background.alpha !== 1) {
    throw new Error("Cannot measure rendered contrast against a transparent background");
  }
  const blend = (front: number, back: number) =>
    front * foreground.alpha + back * (1 - foreground.alpha);
  return {
    alpha: 1,
    blue: blend(foreground.blue, background.blue),
    green: blend(foreground.green, background.green),
    red: blend(foreground.red, background.red),
  };
}

function relativeLuminance(resolved: RenderedColor): number {
  if (resolved.alpha !== 1) {
    throw new Error("Composite a translucent rendered color before calculating contrast");
  }
  const channels = [resolved.red, resolved.green, resolved.blue].map((channel) => {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  const [red, green, blue] = channels;
  if (red === undefined || green === undefined || blue === undefined) {
    throw new Error(`Expected three theme color channels, received ${JSON.stringify(resolved)}`);
  }
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

function contrastRatio(foreground: RenderedColor, background: RenderedColor) {
  const first = relativeLuminance(foreground);
  const second = relativeLuminance(background);
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
}

const suite = createControlUiE2eSuite({
  name: "Control UI browser-rendered muted theme contrast",
  trackBrowserContexts: true,
  unavailableMessage: (executablePath) =>
    `Playwright Chromium is required for theme contrast proof at ${executablePath}`,
});

suite.define(() => {
  it("measures modern rendered colors in sRGB", async () => {
    await suite.withPage({}, async ({ page }) => {
      const rendered = await page.evaluate(() => {
        const probe = document.createElement("span");
        document.body.append(probe);
        // Captured from an actual theme transition; its negative Oklab channel
        // cannot be interpreted as an RGB component.
        probe.style.color = "oklab(0.731043 0.00229835 -0.00707035)";
        const color = getComputedStyle(probe).color;
        probe.remove();
        return color;
      });
      expect(
        (await page.evaluate(resolveRenderedColors, { transition: rendered })).transition,
      ).toEqual({ red: 167, green: 167, blue: 173, alpha: 1 });
    });
  });

  it.each(themeCases)(
    "keeps the $mode palette and Appearance description legible",
    async ({ mode }) => {
      const context = await suite.newBrowserContext({
        colorScheme: mode,
        locale: "en-US",
        serviceWorkers: "block",
        viewport: { height: 900, width: 1440 },
      });
      const page = await context.newPage();
      await installMockGateway(page, {
        methodResponses: { "config.get": themeConfigResponse(mode) },
      });
      const resolved = mode;

      try {
        const response = await page.goto(`${suite.server.baseUrl}settings/appearance`);
        expect(response?.status()).toBe(200);
        await expect.poll(() => page.locator("html").getAttribute("data-theme-mode")).toBe(mode);

        const visibleDescription = page.locator(".settings-section__desc").first();
        await visibleDescription.waitFor({ state: "visible" });

        const rendered = await page.evaluate(
          ({ foregroundNames, surfaceNames }) => {
            const styles = getComputedStyle(document.documentElement);
            const description = document.querySelector<HTMLElement>(".settings-section__desc");
            if (!description) {
              throw new Error("The actual Appearance settings description did not render");
            }
            let opacity = 1;
            const backgroundLayers: string[] = [];
            for (
              let ancestor: HTMLElement | null = description;
              ancestor;
              ancestor = ancestor.parentElement
            ) {
              const ancestorStyles = getComputedStyle(ancestor);
              opacity *= Number(ancestorStyles.opacity);
              backgroundLayers.push(ancestorStyles.backgroundColor);
            }
            return {
              backgroundLayers,
              descriptionColor: getComputedStyle(description).color,
              descriptionOpacity: opacity,
              foregrounds: Object.fromEntries(
                foregroundNames.map((name) => [name, styles.getPropertyValue(name).trim()]),
              ) as Record<string, string>,
              surfaces: Object.fromEntries(
                surfaceNames.map((name) => [name, styles.getPropertyValue(name).trim()]),
              ) as Record<string, string>,
            };
          },
          { foregroundNames: [...textTokens], surfaceNames: [...surfaceTokens] },
        );

        const colors = await page.evaluate(resolveRenderedColors, {
          ...rendered.foregrounds,
          ...rendered.surfaces,
          description: rendered.descriptionColor,
          ...Object.fromEntries(
            rendered.backgroundLayers.map((color, index) => [`layer-${index}`, color]),
          ),
        });

        const pairings = textTokens.flatMap((textToken) =>
          surfaceTokens.map((surfaceToken) => {
            const foreground = rendered.foregrounds[textToken];
            const background = rendered.surfaces[surfaceToken];
            if (!foreground || !background) {
              throw new Error(`Missing browser-resolved ${textToken} or ${surfaceToken}`);
            }
            const contrast = contrastRatio(colors[textToken]!, colors[surfaceToken]!);
            expect(
              contrast,
              `${resolved}: ${textToken} ${foreground} on ${surfaceToken} ${background}`,
            ).toBeGreaterThanOrEqual(4.5);
            return {
              background,
              contrast: Number(contrast.toFixed(3)),
              foreground,
              surfaceToken,
              textToken,
            };
          }),
        );

        let descriptionBackground = colors["--bg"]!;
        for (let index = rendered.backgroundLayers.length - 1; index >= 0; index--) {
          descriptionBackground = compositeColor(colors[`layer-${index}`]!, descriptionBackground);
        }
        const descriptionColor = colors.description!;
        const descriptionForeground = compositeColor(
          {
            ...descriptionColor,
            alpha: descriptionColor.alpha * rendered.descriptionOpacity,
          },
          descriptionBackground,
        );
        const descriptionContrast = contrastRatio(descriptionForeground, descriptionBackground);
        expect(
          descriptionContrast,
          `${resolved}: actual rendered muted Appearance description, including ancestor backgrounds and opacity`,
        ).toBeGreaterThanOrEqual(4.5);

        if (captureUiProof) {
          await mkdir(path.join(suite.artifactDir, "theme-muted-contrast"), { recursive: true });
          const proofName = resolved;
          await page.screenshot({
            animations: "disabled",
            fullPage: true,
            path: path.join(
              path.join(suite.artifactDir, "theme-muted-contrast"),
              `${proofName}.png`,
            ),
          });
          await writeFile(
            path.join(path.join(suite.artifactDir, "theme-muted-contrast"), `${proofName}.json`),
            `${JSON.stringify(
              {
                description: {
                  background: descriptionBackground,
                  contrast: Number(descriptionContrast.toFixed(3)),
                  foreground: descriptionForeground,
                  opacity: rendered.descriptionOpacity,
                },
                mode,
                pairings,
                resolved,
              },
              null,
              2,
            )}\n`,
          );
        }
      } finally {
        await suite.closeBrowserContext(context);
      }
    },
  );

  it("keeps the actual Skill Workshop Suggestions view within a 390px mobile viewport", async () => {
    await suite.withPage(
      {
        locale: "en-US",
        serviceWorkers: "block",
        viewport: { height: 844, width: 390 },
      },
      async ({ page }) => {
        const updatedAt = "2026-07-29T10:00:00.000Z";
        const proposal = {
          createdAt: updatedAt,
          description: "Clean inbox triage",
          id: "proposal-1",
          kind: "create",
          scanState: "clean",
          skillKey: "inbox-cleaner",
          skillName: "Inbox Cleaner",
          status: "pending",
          title: "Inbox Cleaner",
          updatedAt,
        };
        const gateway = await installMockGateway(page, {
          methodResponses: {
            "config.get": themeConfigResponse("light"),
            "skills.proposals.inspect": {
              content: "Review unread mail and archive low-priority threads.",
              record: {
                createdAt: updatedAt,
                description: proposal.description,
                id: proposal.id,
                kind: proposal.kind,
                proposedVersion: "v1",
                status: proposal.status,
                target: { skillKey: proposal.skillKey, skillName: proposal.skillName },
                title: proposal.title,
                updatedAt,
              },
              supportFiles: [],
            },
            "skills.proposals.list": {
              proposals: [proposal],
              schema: "openclaw.skill-workshop.proposals-manifest.v1",
              installedSkills: [],
              updatedAt,
            },
          },
        });

        const response = await page.goto(`${suite.server.baseUrl}skills/workshop`);
        expect(response?.status()).toBe(200);
        await gateway.waitForRequest("skills.proposals.list");

        const todayTab = page.locator("#skill-workshop-mode-tab-suggestions");
        await todayTab.waitFor({ state: "visible" });
        await todayTab.click();

        const today = page.locator(".sw-triage");
        await today.waitFor({ state: "visible" });
        const rendered = await today.evaluate((element) => {
          const styles = getComputedStyle(element);
          return {
            bodyWidth: document.body.scrollWidth,
            boxSizing: styles.boxSizing,
            clientWidth: element.clientWidth,
            parentWidth: element.parentElement?.clientWidth ?? 0,
            scrollWidth: element.scrollWidth,
            viewportWidth: window.innerWidth,
            width: element.getBoundingClientRect().width,
          };
        });

        expect(rendered.viewportWidth).toBe(390);
        expect(rendered.boxSizing).toBe("border-box");
        expect(rendered.width).toBeLessThanOrEqual(rendered.parentWidth);
        expect(rendered.scrollWidth).toBeLessThanOrEqual(rendered.clientWidth);
        expect(rendered.bodyWidth).toBeLessThanOrEqual(rendered.viewportWidth);

        if (captureUiProof) {
          await mkdir(path.join(suite.artifactDir, "theme-muted-contrast"), { recursive: true });
          await page.screenshot({
            animations: "disabled",
            fullPage: true,
            path: path.join(
              path.join(suite.artifactDir, "theme-muted-contrast"),
              "skill-workshop-suggestions-mobile.png",
            ),
          });
          await writeFile(
            path.join(
              path.join(suite.artifactDir, "theme-muted-contrast"),
              "skill-workshop-suggestions-mobile.json",
            ),
            `${JSON.stringify(rendered, null, 2)}\n`,
          );
        }
      },
    );
  });
});

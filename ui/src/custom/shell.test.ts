import { describe, expect, it } from "vitest";
import type { TranslationMap } from "../i18n/lib/types.ts";
import { en } from "../i18n/locales/en.ts";
import { applySharkletCopy, SHARKLET_COPY } from "./shell.ts";

describe("Sharklet copy", () => {
  // A key upstream renamed would be skipped and its old OpenClaw text would
  // come back without a sound; this is where that gets noticed.
  it("replaces every string it names, all of which upstream still has", () => {
    const map = structuredClone(en);
    applySharkletCopy(map);
    for (const [path, value] of Object.entries(SHARKLET_COPY)) {
      const found = path
        .split(".")
        .reduce<unknown>((scope, key) => (scope as TranslationMap | undefined)?.[key], map);
      expect(found, path).toBe(value);
    }
  });
});

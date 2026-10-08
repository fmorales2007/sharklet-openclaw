// @vitest-environment node
// Control UI tests cover theme behavior.
import { describe, expect, it, vi } from "vitest";
import { parseThemeSelection, resolveTheme } from "./theme.ts";

describe("resolveTheme", () => {
  it("resolves explicit modes to themselves", () => {
    expect(resolveTheme("dark")).toBe("dark");
    expect(resolveTheme("light")).toBe("light");
  });

  it("uses system preference when mode is system", () => {
    vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({ matches: true }));
    expect(resolveTheme("system")).toBe("light");
    vi.unstubAllGlobals();
  });
});

describe("parseThemeSelection", () => {
  it("falls back to defaults for unknown stored values", () => {
    expect(parseThemeSelection("fieldmanual", "invalid-mode")).toEqual({
      theme: "claw",
      mode: "system",
    });
    expect(parseThemeSelection("custom", "light")).toEqual({
      theme: "claw",
      mode: "light",
    });
    expect(parseThemeSelection("dash", "light")).toEqual({
      theme: "dash",
      mode: "light",
    });
  });
});

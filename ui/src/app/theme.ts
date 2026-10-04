// Control UI module implements theme behavior.
// Sharklet has one theme family, bridged in custom/theme/bridge.css; only the
// mode varies. ThemeName survives as the stored/synced preference the gateway
// wire contract still carries, and nothing reads it for presentation.
export type ThemeName =
  | "claw"
  | "knot"
  | "dash"
  | "absolutely"
  | "tide"
  | "beacon"
  | "phosphor"
  | "crt"
  | "manuscript"
  | "rose"
  | "miami";
export type ThemeMode = "system" | "light" | "dark";
export type ResolvedTheme = "dark" | "light";

const VALID_THEME_NAMES = new Set<ThemeName>([
  "claw",
  "knot",
  "dash",
  "absolutely",
  "tide",
  "beacon",
  "phosphor",
  "crt",
  "manuscript",
  "rose",
  "miami",
]);

const VALID_THEME_MODES = new Set<ThemeMode>(["system", "light", "dark"]);

function prefersLightScheme(): boolean {
  if (typeof globalThis.matchMedia !== "function") {
    return false;
  }
  return globalThis.matchMedia("(prefers-color-scheme: light)").matches;
}

export function parseThemeSelection(
  themeRaw: unknown,
  modeRaw: unknown,
): { theme: ThemeName; mode: ThemeMode } {
  const theme = typeof themeRaw === "string" ? themeRaw : "";
  const mode = typeof modeRaw === "string" ? modeRaw : "";

  const normalizedTheme = VALID_THEME_NAMES.has(theme as ThemeName) ? (theme as ThemeName) : "claw";
  const normalizedMode = VALID_THEME_MODES.has(mode as ThemeMode) ? (mode as ThemeMode) : "system";

  return { theme: normalizedTheme, mode: normalizedMode };
}

export function resolveTheme(mode: ThemeMode): ResolvedTheme {
  if (mode === "system") {
    return prefersLightScheme() ? "light" : "dark";
  }
  return mode;
}

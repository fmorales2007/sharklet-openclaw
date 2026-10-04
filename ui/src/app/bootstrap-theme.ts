import type { ApplicationGateway, ApplicationTheme } from "./context.ts";
import { syncControlUiSystemChrome } from "./control-ui-presentation.ts";
import {
  bindUiPreferences,
  loadUiPreferences,
  patchSettings,
  settingsKeyForGateway,
  type UiPreferences,
  type UiSettings,
} from "./settings.ts";
import { startThemeTransition } from "./theme-transition.ts";
import { resolveTheme, type ThemeMode } from "./theme.ts";

function applyThemePresentation(settings: UiPreferences): void {
  if (typeof document === "undefined") {
    return;
  }
  const root = document.documentElement;
  // One family: data-theme carries upstream's default names ("dark", "light"),
  // which its component CSS still keys on; the bridge keys on data-theme-mode.
  const resolvedTheme = resolveTheme(settings.themeMode);
  root.dataset.theme = resolvedTheme;
  root.dataset.themeMode = resolvedTheme;
  // Plugin semantic styles select on [data-theme-resolved]; keep it in lockstep
  // with data-theme-mode before their lazy stylesheet loads.
  root.dataset.themeResolved = root.dataset.themeMode;
  root.classList.toggle("wa-light", root.dataset.themeMode === "light");
  root.classList.toggle("wa-dark", root.dataset.themeMode === "dark");
  root.style.colorScheme = root.dataset.themeMode;
  root.style.setProperty("--control-ui-text-scale", `${(settings.textScale ?? 100) / 100}`);
  syncControlUiSystemChrome();
}

export function createApplicationTheme(
  initialSettings: UiSettings,
  gateway: ApplicationGateway,
): ApplicationTheme & { dispose: () => void } {
  const { token: _token, ...initialPreferences } = initialSettings;
  let settings: UiPreferences = initialPreferences;
  let systemThemeCleanup: (() => void) | undefined;
  let chromeBreakpointCleanup: (() => void) | undefined;
  const listeners = new Set<() => void>();

  const publish = () => {
    applyThemePresentation(settings);
    for (const listener of listeners) {
      listener();
    }
  };

  const detachSystemThemeListener = () => {
    systemThemeCleanup?.();
    systemThemeCleanup = undefined;
  };

  const syncSystemThemeListener = () => {
    detachSystemThemeListener();
    if (settings.themeMode !== "system" || typeof globalThis.matchMedia !== "function") {
      return;
    }
    const mediaQuery = globalThis.matchMedia("(prefers-color-scheme: light)");
    const onChange = () => {
      if (settings.themeMode === "system") {
        publish();
      }
    };
    if (typeof mediaQuery.addEventListener === "function") {
      mediaQuery.addEventListener("change", onChange);
      systemThemeCleanup = () => mediaQuery.removeEventListener("change", onChange);
    } else if (typeof mediaQuery.addListener === "function") {
      mediaQuery.addListener(onChange);
      systemThemeCleanup = () => mediaQuery.removeListener(onChange);
    }
  };

  if (typeof globalThis.matchMedia === "function") {
    const mediaQuery = globalThis.matchMedia(
      "(max-width: 768px), (max-width: 932px) and (max-height: 500px) and (orientation: landscape)",
    );
    const onChange = () => syncControlUiSystemChrome();
    if (typeof mediaQuery.addEventListener === "function") {
      mediaQuery.addEventListener("change", onChange);
      chromeBreakpointCleanup = () => mediaQuery.removeEventListener("change", onChange);
    } else if (typeof mediaQuery.addListener === "function") {
      mediaQuery.addListener(onChange);
      chromeBreakpointCleanup = () => mediaQuery.removeListener(onChange);
    }
  }

  const refresh = () => {
    const next = loadUiPreferences(gateway.connection.gatewayUrl);
    if (JSON.stringify(next) === JSON.stringify(settings)) {
      return;
    }
    settings = next;
    publish();
    syncSystemThemeListener();
  };
  const stopPreferences = bindUiPreferences({
    gatewayUrl: () => gateway.connection.gatewayUrl,
    refresh,
  });
  const onStorage = (event: StorageEvent) => {
    if (event.key === null || event.key === settingsKeyForGateway(gateway.connection.gatewayUrl)) {
      refresh();
    }
  };
  globalThis.addEventListener?.("storage", onStorage);
  const stopGateway = gateway.subscribe(() => {
    if (settings.gatewayUrl !== gateway.connection.gatewayUrl) {
      refresh();
    }
  });
  syncSystemThemeListener();
  publish();

  return {
    get settings() {
      return settings;
    },
    get mode() {
      return settings.themeMode;
    },
    get resolvedMode() {
      return resolveTheme(settings.themeMode);
    },
    setMode(mode: ThemeMode, element) {
      startThemeTransition({
        nextTheme: resolveTheme(mode),
        currentTheme: resolveTheme(settings.themeMode),
        context: { element },
        applyTheme: () => {
          patchSettings({ themeMode: mode });
        },
      });
    },
    refresh,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    dispose() {
      stopPreferences();
      globalThis.removeEventListener?.("storage", onStorage);
      stopGateway();
      detachSystemThemeListener();
      chromeBreakpointCleanup?.();
      listeners.clear();
    },
  };
}

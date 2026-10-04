/* @vitest-environment jsdom */

import { afterEach, describe, expect, it, vi } from "vitest";
import { createApplicationTheme } from "./bootstrap-theme.ts";
import { createGatewayStoreTestStore } from "./gateway-store.test-support.ts";
import { loadSettings, patchSettings, saveSettings } from "./settings.ts";

afterEach(() => {
  document.documentElement.removeAttribute("style");
  document.body.replaceChildren();
});

describe("Sharklet theme presentation", () => {
  it("stored accent, typeface and theme family write nothing inline and load no palette", () => {
    const previous = loadSettings();
    saveSettings({
      ...previous,
      theme: "tide",
      themeMode: "light",
      accent: "#fbbf24",
      fontUi: "lora",
      fontChat: "lora",
    });
    const settings = loadSettings();
    const { gateway } = createGatewayStoreTestStore({ settings });
    const theme = createApplicationTheme(settings, gateway);
    try {
      const root = document.documentElement;
      expect(root.dataset.theme).toBe("light");
      expect(root.dataset.themeMode).toBe("light");
      for (const property of ["--accent", "--primary", "--ring", "--font-body", "--font-chat"]) {
        expect(root.style.getPropertyValue(property)).toBe("");
      }
      expect(document.querySelector('link[id^="openclaw-theme-palette-"]')).toBeNull();
    } finally {
      theme.dispose();
      gateway.stop();
      saveSettings(previous);
    }
  });
});

describe("Live display preference presentation", () => {
  it("publishes preferences without render-time storage reads", () => {
    const previous = loadSettings();
    const { gateway } = createGatewayStoreTestStore({ settings: previous });
    const theme = createApplicationTheme(previous, gateway);
    const notify = vi.fn();
    const unsubscribe = theme.subscribe(notify);
    try {
      patchSettings({
        chatSendShortcut: "modifier-enter",
        realtimeTalkInputDeviceId: "usb-mic",
      });
      expect(theme.settings).toMatchObject({
        chatSendShortcut: "modifier-enter",
        realtimeTalkInputDeviceId: "usb-mic",
      });
      expect(theme.settings).not.toHaveProperty("token");
      expect(notify).toHaveBeenCalled();
      const reads = vi.spyOn(Storage.prototype, "getItem");
      for (let i = 0; i < 20; i++) {
        expect(theme.settings.chatSendShortcut).toBe("modifier-enter");
      }
      expect(reads).not.toHaveBeenCalled();
    } finally {
      vi.restoreAllMocks();
      unsubscribe();
      theme.dispose();
      gateway.stop();
      saveSettings(previous);
    }
  });
});

// English at first paint. Sharklet's UI is en-US and Spanish is an explicit
// choice (docs/plan-ui-fases.md, "Idioma"), but upstream picks the browser
// language when nothing is stored, so an es-CL browser opens in Spanish — and
// every Sharklet string, which exists only in English, disappears behind it.
//
// Storing "en" when nothing is stored fixes the first paint and leaves a
// language picked in Settings alone. Once connected, the gateway's synced
// preference takes over; shell.ts makes its "system" value English too. This
// is its own module, and the first import of custom/index.ts, because
// i18n/lib/translate.ts reads the key once, when its module evaluates.
import { getSafeLocalStorage } from "../local-storage.ts";

const LOCALE_KEY = "openclaw.i18n.locale";

try {
  const storage = getSafeLocalStorage();
  if (storage && !storage.getItem(LOCALE_KEY)) {
    storage.setItem(LOCALE_KEY, "en");
  }
} catch {
  // Blocked storage: upstream falls back to the browser language, as before.
}

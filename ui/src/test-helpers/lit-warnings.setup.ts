import { installSafeLocalStorageForTesting } from "./storage.ts";

// Lit emits a one-time dev-mode warning in test builds. Pre-mark it as issued
// so broad UI suites stay signal-heavy instead of repeating the same console.warn.
const issuedWarnings = ((globalThis as { litIssuedWarnings?: Set<string> }).litIssuedWarnings ??=
  new Set<string>());

issuedWarnings.add("dev-mode");

// Pin locale and time zone so formatting assertions do not depend on the host.
// Windows ICU ignores LANG/LC_ALL, so the default locale is pinned in-process;
// Node re-reads TZ on assignment. Node's own `navigator.language` (which i18n
// reads) also follows the host locale. Browser runs get both from the launcher.
if (!("__vitest_browser__" in globalThis)) {
  process.env.TZ = "UTC";
  const locale = "en-US";
  if (globalThis.navigator) {
    Object.defineProperty(globalThis.navigator, "language", {
      configurable: true,
      get: () => locale,
    });
    Object.defineProperty(globalThis.navigator, "languages", {
      configurable: true,
      get: () => [locale],
    });
  }
  for (const key of [
    "Collator",
    "DateTimeFormat",
    "ListFormat",
    "NumberFormat",
    "PluralRules",
    "RelativeTimeFormat",
    "Segmenter",
  ] as const) {
    Object.defineProperty(Intl, key, {
      configurable: true,
      writable: true,
      value: new Proxy(Intl[key], {
        apply: (target, thisArg, [locales, ...rest]) =>
          Reflect.apply(target, thisArg, [locales ?? locale, ...rest]),
        construct: (target, [locales, ...rest], newTarget) =>
          Reflect.construct(target, [locales ?? locale, ...rest], newTarget),
      }),
    });
  }
  for (const [proto, method, index] of [
    [Number.prototype, "toLocaleString", 0],
    [BigInt.prototype, "toLocaleString", 0],
    [Date.prototype, "toLocaleString", 0],
    [Date.prototype, "toLocaleDateString", 0],
    [Date.prototype, "toLocaleTimeString", 0],
    [String.prototype, "localeCompare", 1],
  ] as const) {
    const original = (proto as unknown as Record<string, (...args: unknown[]) => unknown>)[method];
    if (!original) {
      continue;
    }
    Object.defineProperty(proto, method, {
      configurable: true,
      writable: true,
      value(this: unknown, ...args: unknown[]) {
        args[index] ??= locale;
        return original.apply(this, args);
      },
    });
  }
}

// Web Awesome resolves `for` targets while Lit content is still in a detached
// render root. The app renders into a connected root; JSDOM unit helpers do not.
const findElementById = (root: ParentNode, id: string) =>
  [...root.querySelectorAll<HTMLElement>("[id]")].find((element) => element.id === id) ?? null;

if (typeof DocumentFragment !== "undefined" && !("getElementById" in DocumentFragment.prototype)) {
  Object.defineProperty(DocumentFragment.prototype, "getElementById", {
    configurable: true,
    value(this: DocumentFragment, id: string) {
      return findElementById(this, id);
    },
  });
}

if (typeof Element !== "undefined" && !("getElementById" in Element.prototype)) {
  Object.defineProperty(Element.prototype, "getElementById", {
    configurable: true,
    value(this: Element, id: string) {
      return findElementById(this, id);
    },
  });
}

// JSDOM has no Web Animations API. Web Awesome uses this probe to skip
// animations when none are active.
if (typeof Element !== "undefined" && !("getAnimations" in Element.prototype)) {
  Object.defineProperty(Element.prototype, "getAnimations", {
    configurable: true,
    value: () => [],
  });
}

// JSDOM exposes partial ElementInternals. Web Awesome form controls require
// the form-associated methods even when tests do not mount them in a form.
// Browser tests need native CustomStateSet so CSS :state() observes real state.
if (typeof HTMLElement !== "undefined" && !("__vitest_browser__" in globalThis)) {
  Object.defineProperty(HTMLElement.prototype, "attachInternals", {
    configurable: true,
    value() {
      const validity = { valid: true } as ValidityState;
      return {
        checkValidity: () => true,
        form: null,
        labels: null,
        reportValidity: () => true,
        setFormValue: () => {},
        setValidity: () => {},
        states: new Set<string>(),
        validationMessage: "",
        validity,
        willValidate: true,
      };
    },
  });
}

if (typeof HTMLDialogElement !== "undefined" && !("showModal" in HTMLDialogElement.prototype)) {
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", {
    configurable: true,
    value(this: HTMLDialogElement) {
      this.setAttribute("open", "");
    },
  });
}

if (typeof HTMLDialogElement !== "undefined" && !("close" in HTMLDialogElement.prototype)) {
  Object.defineProperty(HTMLDialogElement.prototype, "close", {
    configurable: true,
    value(this: HTMLDialogElement) {
      this.removeAttribute("open");
    },
  });
}

// Node 25+ exposes accessor-backed WebStorage that can be disabled or inert.
// Vitest intentionally rejects all storage accessors, so jsdom needs an owned
// value descriptor even when invoking the original getter appears to work.
function globalLocalStorageIsUsable(): boolean {
  try {
    const existing = globalThis.localStorage;
    if (!existing) {
      return false;
    }
    existing.setItem("__openclaw_probe__", "1");
    const roundTrips = existing.getItem("__openclaw_probe__") === "1";
    existing.removeItem("__openclaw_probe__");
    return roundTrips;
  } catch {
    return false;
  }
}

if (
  typeof window !== "undefined" &&
  ((typeof process !== "undefined" && Boolean(process.env?.VITEST)) ||
    !globalLocalStorageIsUsable())
) {
  installSafeLocalStorageForTesting(window);
}

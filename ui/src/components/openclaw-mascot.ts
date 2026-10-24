// Sharklet's shark, the app's mascot. It replaces OpenClaw's canvas mascot (the
// canvas drew with colors hardcoded in the component, so no theme token could
// reach it); the element keeps the name and the public surface the places that
// mount it already use:
//   mood  (reflected attribute; upstream's nine moods), size (px), tease.
//
// What it draws (motion.md): the shark swims while something is being worked
// on — the thinking and working moods — and is still otherwise. Upstream's
// other moods have no Sharklet counterpart and show the still mark. While it
// swims, data-effort sets the speed of the cycle (motion.md, "Effort sets the
// speed"); without it the swim runs at the default level.
//
// Light DOM, not a shadow root: initMotion() watches the document for SMIL it
// has to pause under reduced motion, and it cannot see inside shadow roots.

import { SHARKLET_MARK_SVG } from "../custom/brand/mark.js";

const DEFAULT_SIZE = 120;
const SWIMMING_MOODS = new Set(["thinking", "working"]);

// 57 KB of path data, plus the motion runtime: loaded the first time any mascot
// swims, not at startup. The swim is the app's only SMIL, so the runtime that
// pauses SMIL under reduced motion is only needed from that moment, and it is
// started before the first swimming SVG is inserted, so its observer sees it.
// Keeping both out of the startup graph is what keeps upstream's startup budget
// (scripts/check-control-ui-performance.mts) intact.
type SwimRuntime = {
  svg: string;
  applyEffort: (el: Element, level: string) => void;
};
let swimRuntime: Promise<SwimRuntime> | undefined;
function loadSwimRuntime(): Promise<SwimRuntime> {
  swimRuntime ??= Promise.all([
    import("../custom/brand/swim.js"),
    import("../custom/motion.js"),
  ]).then(([art, motion]) => {
    motion.initMotion();
    return { svg: art.SHARKLET_SWIM_SVG, applyEffort: motion.applyEffort };
  });
  return swimRuntime;
}

// Node-environment tests import the icon set, which mounts this element.
const ElementBase = (
  typeof HTMLElement === "undefined" ? Object : HTMLElement
) as typeof HTMLElement;

class OpenClawMascot extends ElementBase {
  static readonly observedAttributes = ["mood"];

  #size = DEFAULT_SIZE;
  #drawn: "mark" | "swim" | "" = "";
  tease = false;

  constructor() {
    super();
    // A property set before the element upgraded lives on the instance and
    // would shadow the accessors; re-apply it through them.
    for (const key of ["mood", "size", "tease"] as const) {
      if (Object.hasOwn(this, key)) {
        const value = (this as Record<string, unknown>)[key];
        delete (this as Record<string, unknown>)[key];
        (this as Record<string, unknown>)[key] = value;
      }
    }
  }

  get mood(): string {
    return this.getAttribute("mood") ?? "idle";
  }

  set mood(value: string) {
    this.setAttribute("mood", value || "idle");
  }

  get size(): number {
    return this.#size;
  }

  set size(value: number) {
    this.#size = Number.isFinite(value) && value > 0 ? value : DEFAULT_SIZE;
    this.style.setProperty("--openclaw-mascot-size", `${this.#size}px`);
  }

  connectedCallback(): void {
    if (!this.hasAttribute("mood")) {
      // A glyph standing in for a status icon swims, except in the recap row,
      // which reports a turn that already finished.
      const glyph = this.hasAttribute("data-glyph");
      this.setAttribute("mood", glyph && !this.closest(".chat-turn-recap") ? "working" : "idle");
    }
    this.style.setProperty("--openclaw-mascot-size", `${this.#size}px`);
    this.#render();
  }

  attributeChangedCallback(): void {
    this.#render();
  }

  /** The shark has no catch animation; the welcome screen calls this on a file drop. */
  catchOnce(): void {}

  #render(): void {
    if (!this.isConnected) {
      return;
    }
    if (!SWIMMING_MOODS.has(this.mood)) {
      this.#draw("mark", SHARKLET_MARK_SVG);
      return;
    }
    if (this.#drawn === "swim") {
      return;
    }
    // Still mark until the swim arrives, so the slot is never empty.
    if (this.#drawn === "") {
      this.#draw("mark", SHARKLET_MARK_SVG);
    }
    void loadSwimRuntime().then(({ svg, applyEffort }) => {
      if (this.isConnected && SWIMMING_MOODS.has(this.mood)) {
        this.#draw("swim", svg);
        applyEffort(this, this.dataset.effort ?? "");
      }
    });
  }

  #draw(kind: "mark" | "swim", svg: string): void {
    if (this.#drawn === kind) {
      return;
    }
    this.#drawn = kind;
    // The markup is our own generated art (custom/brand/*.js), never user input.
    this.innerHTML = svg;
  }
}

if (typeof customElements !== "undefined" && !customElements.get("openclaw-mascot")) {
  customElements.define("openclaw-mascot", OpenClawMascot);
}

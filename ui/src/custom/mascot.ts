// Sharklet's shark in place of OpenClaw's canvas mascot.
//
// Upstream draws its mascot on a <canvas> with colors hardcoded in
// mascot-pose.ts:47-57, so no token reaches it. Replacing it does not need a
// patch: components/openclaw-mascot.ts:233 defines the element only
// `if (!customElements.get("openclaw-mascot"))`. Defining ours first, from
// custom/index.ts, which main.ts imports before app-host.ts, is enough — the six
// places that mount <openclaw-mascot> get this element and none of them change.
//
// The public surface matches upstream's, because those six sites use it:
//   mood  (reflected attribute; upstream's nine moods), size (px), tease.
//
// What it draws (motion.md): the shark swims while something is being worked
// on — the thinking and working moods — and is still otherwise. Upstream's
// other moods have no Sharklet counterpart and show the still mark.
//
// Light DOM, not a shadow root: initMotion() watches the document for SMIL it
// has to pause under reduced motion, and it cannot see inside shadow roots.

import { html } from "lit";
import { icons } from "../components/icons.ts";
import { SHARKLET_MARK_SVG } from "./brand/mark.js";

const DEFAULT_SIZE = 120;
const SWIMMING_MOODS = new Set(["thinking", "working"]);

// 57 KB of path data, plus the motion runtime: loaded the first time any mascot
// swims, not at startup. The swim is the app's only SMIL, so the runtime that
// pauses SMIL under reduced motion is only needed from that moment, and it is
// started before the first swimming SVG is inserted, so its observer sees it.
// Keeping both out of the startup graph is what keeps upstream's startup budget
// (scripts/check-control-ui-performance.mts) intact.
let swimArt: Promise<string> | undefined;
function loadSwimArt(): Promise<string> {
  swimArt ??= Promise.all([import("./brand/swim.js"), import("./motion.js")]).then(
    ([art, motion]) => {
      motion.initMotion();
      return art.SHARKLET_SWIM_SVG;
    },
  );
  return swimArt;
}

class SharkletMascot extends HTMLElement {
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
      // A glyph standing in for upstream's claw (see replaceClawGlyph) swims,
      // except in the recap row, which reports a turn that already finished.
      const glyph = this.hasAttribute("data-glyph");
      this.setAttribute("mood", glyph && !this.closest(".chat-turn-recap") ? "working" : "idle");
    }
    this.style.setProperty("--openclaw-mascot-size", `${this.#size}px`);
    this.#render();
  }

  attributeChangedCallback(): void {
    this.#render();
  }

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
    void loadSwimArt().then((svg) => {
      if (this.isConnected && SWIMMING_MOODS.has(this.mood)) {
        this.#draw("swim", svg);
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

// Upstream's animated claw (icons-tools.ts:155) is what the chat shows while
// the agent works, plus four more places (turn recap, background tasks,
// sub-agents, settings save). One swap on the shared icons object reaches all
// five without touching them; every consumer reads icons.claw at render time.
export function replaceClawGlyph(): void {
  Object.assign(icons, {
    claw: html`<openclaw-mascot data-glyph .size=${22}></openclaw-mascot>`,
  });
}

export function defineSharkletMascot(): void {
  if (typeof customElements === "undefined" || customElements.get("openclaw-mascot")) {
    return;
  }
  customElements.define("openclaw-mascot", SharkletMascot);
}

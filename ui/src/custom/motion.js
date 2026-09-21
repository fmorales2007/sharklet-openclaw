/* GENERATED COPY - do not edit here.
 * Source: sharklet/docs/design-system/motion.js @ ecb95b5
 * Remake it with: node docs/design-system/sync-to-fork.mjs
 * Editing this file instead of the source is how Adrift drifted. */

// Sharklet motion runtime.
//
// CSS cannot stop the shark: it swims with SMIL <animate>, and only
// pauseAnimations() stops that. Everything motion.md needs from script lives
// here so that any page shipping the design system behaves the same — the
// kitchen sink, the brand preview and the app.
//
// Node may import this file (family.mjs and gen.mjs read EFFORT); nothing
// touches the DOM until initMotion() runs.

// ---------- Effort ----------
// The swim carries how hard the model is thinking (motion.md). `dur` is the
// cycle and can change at runtime; `amp` is the swing, which is baked into the
// frames, so a different amp needs a different SVG from brand/gen.mjs.
export const EFFORT = [
  { level: "off", dur: "1.8s", amp: 0.34, label: "Working" },
  { level: "minimal", dur: "1.8s", amp: 1 },
  { level: "low", dur: "1.4s", amp: 1 },
  { level: "medium", dur: "1.1s", amp: 1 },
  { level: "adaptive", dur: "1.1s", amp: 1 },
  { level: "high", dur: "0.95s", amp: 1 },
  { level: "xhigh", dur: "0.85s", amp: 1 },
  { level: "max", dur: "0.7s", amp: 1 },
  { level: "ultra", dur: "0.7s", amp: 1.25 },
];
export const DEFAULT_EFFORT = "medium";
export const effortFor = (level) =>
  EFFORT.find((e) => e.level === level) ?? EFFORT.find((e) => e.level === DEFAULT_EFFORT);

// The loading screen always runs at the default cycle, whatever the message asked for.
export const SPLASH_DUR = effortFor(DEFAULT_EFFORT).dur;

// ---------- Reduced motion ----------
const REDUCED_QUERY = "(prefers-reduced-motion: reduce)";
const mediaReduced = () => typeof matchMedia === "function" && matchMedia(REDUCED_QUERY).matches;

// data-motion="reduced" is the in-app setting and absent means follow the OS,
// which is exactly what the CSS in components.css matches on. "full" is a
// review escape hatch used by the kitchen sink: it only forces the motion that
// script drives (the SMIL swim), because CSS keeps honouring the OS setting.
export function isReduced(root = document.documentElement) {
  // The CSS matches [data-motion="reduced"] *, so an ancestor counts too.
  const set = root?.closest?.("[data-motion]")?.dataset?.motion ?? root?.dataset?.motion;
  return set === "reduced" || (set !== "full" && mediaReduced());
}

const SMIL_TAGS = "animate, animateTransform, animateMotion, set";
const smil = (scope) =>
  Array.from(scope.querySelectorAll("svg")).filter(
    (s) => typeof s.pauseAnimations === "function" && s.querySelector(SMIL_TAGS),
  );

// Paused on the first frame, so "thinking" is still visible without movement.
export function syncSmil(root = document.documentElement, reduced = isReduced(root)) {
  for (const svg of smil(root)) {
    try {
      if (reduced) {
        svg.pauseAnimations();
        svg.setCurrentTime(0);
      } else svg.unpauseAnimations();
    } catch {
      /* a detached or not-yet-laid-out SVG: the next sync catches it */
    }
  }
  return reduced;
}

// ---------- Effort at runtime ----------
// Applies the cycle to every SMIL animation under `el` and restarts it so the
// frames stay in step. Returns the level actually applied.
export function applyEffort(el, level) {
  const e = effortFor(level);
  const targets = el.tagName?.toLowerCase() === "svg" ? [el] : smil(el);
  for (const svg of targets) {
    // Retime every SMIL element, not just <animate>: the Reef mark uses
    // <animateTransform>, and it would otherwise drift out of step.
    const anims = svg.querySelectorAll("animate, animateTransform, animateMotion");
    // Restarting the clock is what keeps the frames in step, but it is also a
    // visible jump, so only do it when the cycle actually changed.
    let changed = false;
    for (const a of anims) {
      if (a.getAttribute("dur") === e.dur) continue;
      a.setAttribute("dur", e.dur);
      changed = true;
    }
    if (changed) {
      try {
        svg.setCurrentTime(0);
      } catch {
        /* not laid out yet */
      }
    }
  }
  return e.level;
}

// Every [data-effort] in the scope picks up its cycle.
export function syncEffort(root = document.documentElement) {
  for (const el of root.querySelectorAll("[data-effort]")) applyEffort(el, el.dataset.effort);
}

// ---------- Wiring ----------
// Watches the OS setting, the in-app setting and anything added later, which is
// what the kitchen sink's one-off script never did.
export function initMotion({ root = document.documentElement, watch = true } = {}) {
  syncEffort(root);
  syncSmil(root);
  if (!watch) return () => {};

  const mq = typeof matchMedia === "function" ? matchMedia(REDUCED_QUERY) : null;
  const onMedia = () => syncSmil(root);
  mq?.addEventListener("change", onMedia);

  // Three separate reactions, because collapsing them restarts every animation
  // on any DOM change: in a live app that is every render.
  // setTimeout, not requestAnimationFrame: rAF does not fire in a hidden tab,
  // which would leave the reduced-motion setting unapplied until it is shown.
  let pending = null;
  const queue = (fn) => {
    (pending ??= new Set()).add(fn);
    if (pending.size > 1) return;
    setTimeout(() => {
      const run = pending;
      pending = null;
      for (const f of run) f();
    }, 0);
  };
  const observer = new MutationObserver((records) => {
    const effortTargets = new Set();
    let motionChanged = false,
      added = false;
    for (const r of records) {
      if (r.type === "attributes") {
        if (r.attributeName === "data-effort") effortTargets.add(r.target);
        else motionChanged = true;
      } else if (r.addedNodes.length) added = true;
    }
    // Only the elements whose level actually changed get retimed.
    for (const el of effortTargets) queue(() => applyEffort(el, el.dataset.effort));
    // Nodes added later still have to obey the current setting, but their
    // clocks are left alone.
    if (motionChanged || added) queue(() => syncSmil(root));
  });
  observer.observe(root, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ["data-motion", "data-effort"],
  });

  return () => {
    mq?.removeEventListener("change", onMedia);
    observer.disconnect();
  };
}

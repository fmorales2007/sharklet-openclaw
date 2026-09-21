// Types for motion.js, the synced copy of sharklet/docs/design-system/motion.js.
// That file stays plain JavaScript because Node imports it too (brand/gen.mjs
// and family.mjs read EFFORT), and the UI tsconfig does not allowJs.
// Hand-written on purpose: the runtime's surface is small and changes rarely;
// if it grows, this file is what fails the typecheck first.

export type EffortLevel =
  | "off"
  | "minimal"
  | "low"
  | "medium"
  | "adaptive"
  | "high"
  | "xhigh"
  | "max"
  | "ultra";

export type EffortStep = {
  level: EffortLevel;
  dur: string;
  amp: number;
  label?: string;
};

export const EFFORT: readonly EffortStep[];
export const DEFAULT_EFFORT: EffortLevel;
export const SPLASH_DUR: string;
export function effortFor(level: string): EffortStep;
export function isReduced(root?: Element): boolean;
export function syncSmil(root?: Element, reduced?: boolean): void;
export function applyEffort(el: Element, level: string): void;
export function syncEffort(root?: Element): void;
export function initMotion(options?: { root?: Element; watch?: boolean }): void;

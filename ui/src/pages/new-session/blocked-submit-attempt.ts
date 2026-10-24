import { PAGE_RENDERED_GATES, type NewSessionSubmitBlock } from "./submit-gates.ts";

/** Remembers which gate blocked the last submit attempt so its reason can be shown until it lifts. */
export class BlockedSubmitAttempt {
  private gate: string | null = null;

  constructor(
    private readonly currentBlock: () => NewSessionSubmitBlock | undefined,
    private readonly requestUpdate: () => void,
  ) {}

  /** A submit was attempted (Enter or Start click) while a gate blocked it. */
  note() {
    this.gate = this.currentBlock()?.gate ?? null;
    this.requestUpdate();
  }

  clear() {
    this.gate = null;
  }

  /** Attempt-bound reason that retires when its transient gate lifts. */
  notice(): string | undefined {
    const block = this.gate ? this.currentBlock() : undefined;
    return block?.gate === this.gate && !PAGE_RENDERED_GATES.has(block.gate)
      ? block.reason
      : undefined;
  }
}

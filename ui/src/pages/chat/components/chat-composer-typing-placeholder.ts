/** Types the Home composer placeholder in once per mount; the chat composer never uses it. */
export class TypingPlaceholder {
  private frame: number | null = null;
  private startedAt: number | null = null;
  private text = "";
  private target = "";
  private entered = false;

  get(target: string, message: string, requestUpdate: () => void): string {
    if (message.length > 0 || this.entered) {
      this.entered = true;
      if (this.frame !== null) {
        globalThis.cancelAnimationFrame?.(this.frame);
        this.frame = null;
      }
      return target;
    }
    if (this.target !== target) {
      this.reset();
      this.target = target;
    }
    const requestFrame = globalThis.requestAnimationFrame?.bind(globalThis);
    if (
      !requestFrame ||
      (globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false)
    ) {
      this.text = target;
      this.entered = true;
      return target;
    }
    if (this.frame === null) {
      const step = (timestamp: number) => {
        this.startedAt ??= timestamp;
        const elapsed = Math.max(0, timestamp - this.startedAt - 180);
        const length = Math.min(target.length, Math.floor(elapsed / 26));
        if (length !== this.text.length) {
          this.text = target.slice(0, length);
          requestUpdate();
        }
        if (length < target.length) {
          this.frame = requestFrame(step);
          return;
        }
        this.frame = null;
        this.entered = true;
      };
      this.frame = requestFrame(step);
    }
    return this.text;
  }

  reset() {
    if (this.frame !== null) {
      globalThis.cancelAnimationFrame?.(this.frame);
      this.frame = null;
    }
    this.startedAt = null;
    this.text = "";
    this.target = "";
    this.entered = false;
  }
}

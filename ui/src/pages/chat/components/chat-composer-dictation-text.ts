import { insertComposerDictation } from "../composer-dictation.ts";
import { adjustTextareaHeight } from "./chat-composer-dom.ts";

type CapturedSelection = { start: number; end: number; value: string };

/**
 * Draft text edits for direct (click-to-dictate) dictation on a composer
 * textarea. Home dictates this way because it has no Talk capability.
 */
export class ComposerDictationText {
  private captured: CapturedSelection | null = null;

  constructor(private readonly getTextarea: () => HTMLTextAreaElement | null) {}

  /**
   * Remembers the live draft and caret before another control takes focus.
   * Partial previews rewrite the textarea, so commit must keep using this base
   * snapshot or each successive transcript would be inserted into the last preview.
   */
  captureSelection() {
    const target = this.getTextarea();
    this.captured = target
      ? { start: target.selectionStart, end: target.selectionEnd, value: target.value }
      : null;
  }

  previewTranscript(transcript: string): string | undefined {
    const target = this.getTextarea();
    if (!target) {
      return undefined;
    }
    const selection = this.captured ?? {
      start: target.selectionStart,
      end: target.selectionEnd,
      value: target.value,
    };
    return insertComposerDictation(selection.value, transcript, selection.start, selection.end)
      .value;
  }

  /**
   * Writes a transcript into the draft at the remembered caret and returns the
   * new draft, or null when there is nothing to insert.
   *
   * The captured element value includes keystrokes not yet committed upward.
   * Writing the final insertion directly grows the box before the next render
   * commits that same value into the page-owned draft.
   */
  insertTranscript(transcript: string, late?: true): string | null {
    const target = this.getTextarea();
    if (!target) {
      return null;
    }
    const captured = this.captured;
    // Delayed finals must not replace edits made after Stop unlocked this draft.
    const selection =
      captured && (!late || captured.value === target.value)
        ? captured
        : {
            start: late ? target.selectionStart : target.value.length,
            end: late ? target.selectionEnd : target.value.length,
            value: target.value,
          };
    this.captured = null;
    const insertion = insertComposerDictation(
      selection.value,
      transcript,
      selection.start,
      selection.end,
    );
    if (insertion.value === selection.value) {
      return null;
    }
    target.value = insertion.value;
    adjustTextareaHeight(target);
    queueMicrotask(() => {
      if (!target.isConnected) {
        return;
      }
      target.focus({ preventScroll: true });
      target.selectionStart = insertion.caret;
      target.selectionEnd = insertion.caret;
    });
    return insertion.value;
  }
}

/* @vitest-environment jsdom */

import { afterEach, describe, expect, it } from "vitest";
import { ComposerDictationText } from "./chat-composer-dictation-text.ts";

let textarea: HTMLTextAreaElement | null = null;

function setup(value: string, start: number, end = start) {
  const element = document.createElement("textarea");
  document.body.append(element);
  element.value = value;
  element.selectionStart = start;
  element.selectionEnd = end;
  textarea = element;
  return { element, text: new ComposerDictationText(() => textarea) };
}

afterEach(() => {
  textarea?.remove();
  textarea = null;
});

describe("composer dictation text", () => {
  it("inserts at the caret the writer left, not where the caret ended up", () => {
    const { element, text } = setup("ship it", 4);

    // Pressing the microphone blurs the draft, so the caret is read then rather
    // than when the transcript comes back and the caret has moved.
    text.captureSelection();
    element.selectionStart = element.value.length;
    element.selectionEnd = element.value.length;

    expect(text.insertTranscript("please")).toBe("ship please it");
    expect(element.value).toBe("ship please it");
  });

  it("preserves edits made after Stop before inserting a late transcript", () => {
    const { element, text } = setup("ship it", 4);
    text.captureSelection();
    element.value = "ship it today";
    element.selectionStart = 4;
    element.selectionEnd = 4;

    expect(text.insertTranscript("please", true)).toBe("ship please it today");
    expect(element.value).toBe("ship please it today");
  });

  it("replaces the range the writer had highlighted", () => {
    const { text } = setup("ship the thing", 5, 14);
    text.captureSelection();

    expect(text.insertTranscript("it now")).toBe("ship it now");
  });

  it("appends when no caret was captured", () => {
    const { text } = setup("ship", 0);

    expect(text.insertTranscript("it")).toBe("ship it");
  });

  it("reads uncommitted keystrokes from the draft rather than the committed value", () => {
    const { text } = setup("ship the", 8);
    text.captureSelection();

    expect(text.insertTranscript("thing")).toBe("ship the thing");
  });

  it("reports nothing to insert for a blank transcript so the draft is left alone", () => {
    const { element, text } = setup("ship it", 7);
    text.captureSelection();

    expect(text.insertTranscript("   ")).toBeNull();
    expect(element.value).toBe("ship it");
  });

  it("spends a captured caret once, so a later transcript appends instead of reusing it", () => {
    const { text } = setup("ship it", 0);
    text.captureSelection();

    expect(text.insertTranscript("please")).toBe("please ship it");
    expect(text.insertTranscript("now")).toBe("please ship it now");
  });

  it("previews from the captured draft without consuming or mutating it", () => {
    const { element, text } = setup("ship it", 4);
    text.captureSelection();

    expect(text.previewTranscript("please")).toBe("ship please it");
    expect(element.value).toBe("ship it");
    expect(text.insertTranscript("please")).toBe("ship please it");
  });

  it("has nothing to insert into once the draft is gone", () => {
    const { text } = setup("ship it", 0);
    text.captureSelection();
    textarea = null;

    expect(text.insertTranscript("it")).toBeNull();
  });
});

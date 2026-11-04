import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createQuestionPromptState,
  disposeQuestionPromptState,
  dropBackgroundedSecretDrafts,
  handleQuestionPromptEvent,
} from "./question-prompt.ts";

type State = ReturnType<typeof createQuestionPromptState>;

const states: State[] = [];

function createState(onChange = vi.fn()) {
  const state = createQuestionPromptState(onChange);
  states.push(state);
  return state;
}

const secretQuestion = {
  questionId: "secret_value",
  header: "Credential",
  question: "Paste the credential for SERVICE_API_KEY",
  options: [],
  isOther: true,
  isSecret: true,
  secretStore: { name: "SERVICE_API_KEY", kind: "secret" },
};

const formatQuestion = {
  questionId: "format",
  header: "Format",
  question: "Which format should I use?",
  options: [{ label: "Compact", description: "Keep it brief" }, { label: "Detailed" }],
  isOther: true,
};

function request(state: State, questions: unknown[]) {
  handleQuestionPromptEvent(state, {
    event: "question.requested",
    payload: {
      id: "question-1",
      questions,
      agentId: "main",
      sessionKey: "agent:main:main",
      runId: "run-question",
      createdAtMs: 1_000,
      expiresAtMs: Date.now() + 60_000,
      status: "pending",
    },
  });
  return state.prompts.get("question-1")!;
}

afterEach(() => {
  for (const state of states.splice(0)) {
    disposeQuestionPromptState(state);
  }
});

describe("dropBackgroundedSecretDrafts", () => {
  it("empties a typed credential, keeps other drafts and tells the view", () => {
    const onChange = vi.fn();
    const state = createState(onChange);
    const prompt = request(state, [secretQuestion, formatQuestion]);
    prompt.drafts.set("secret_value", { selected: new Set(), freeText: "typed-credential-value" });
    prompt.drafts.set("format", { selected: new Set(), freeText: "Compact please" });
    const revision = prompt.revision;
    onChange.mockClear();

    expect(dropBackgroundedSecretDrafts(state)).toBe(true);

    expect(prompt.drafts.has("secret_value")).toBe(false);
    expect(prompt.drafts.get("format")?.freeText).toBe("Compact please");
    expect(prompt.revision).toBeGreaterThan(revision);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(dropBackgroundedSecretDrafts(state)).toBe(false);
  });

  it("leaves a credential that is already being submitted alone", () => {
    const state = createState();
    const prompt = request(state, [secretQuestion]);
    prompt.drafts.set("secret_value", { selected: new Set(), freeText: "in-flight-value" });
    prompt.submitting = true;

    expect(dropBackgroundedSecretDrafts(state)).toBe(false);
    expect(prompt.drafts.get("secret_value")?.freeText).toBe("in-flight-value");
  });
});

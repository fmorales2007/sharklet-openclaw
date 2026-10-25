/* @vitest-environment jsdom */

import { afterEach, describe, expect, it, vi } from "vitest";
import type { ApplicationContext } from "../../app/context.ts";
import type { ApplicationGateway } from "../../app/gateway.ts";
import { createApplicationContextProvider } from "../../test-helpers/application-context.ts";
import { waitForFast } from "../../test-helpers/wait-for.ts";
import "./job-progress.ts";

const sessionKey = "agent:main:synthetic-refactor";

function createGateway(card: unknown) {
  const request = vi.fn(async () => ({ card }));
  let onEvent: ((event: { event: string; payload: unknown }) => void) | undefined;
  const gateway = {
    snapshot: {
      client: { request },
      phase: "connected",
      hello: {
        features: { methods: ["progressCard.get"] },
        snapshot: { sessionDefaults: { mainKey: "main", defaultAgentId: "main" } },
      },
    },
    subscribe: () => () => undefined,
    subscribeEvents: (listener: NonNullable<typeof onEvent>) => {
      onEvent = listener;
      return () => undefined;
    },
  } as unknown as ApplicationGateway;
  return {
    gateway,
    request,
    emit: (event: string, payload: unknown) => onEvent?.({ event, payload }),
  };
}

function mount(gateway: ApplicationGateway) {
  const provider = createApplicationContextProvider({ gateway } as unknown as ApplicationContext);
  const element = document.createElement("sharklet-job-progress");
  element.setAttribute("session-key", sessionKey);
  element.setAttribute("agent-id", "main");
  element.setAttribute("fallback", "Running");
  provider.append(element);
  document.body.append(provider);
  return element;
}

afterEach(() => document.body.replaceChildren());

describe("Working now progress step", () => {
  it("shows the current step from the gateway's progress card, and a fresh mount gets it again", async () => {
    const card = {
      sessionKey,
      revision: 2,
      updatedAt: 2,
      steps: [
        { step: "Read the billing module", status: "completed" },
        { step: "Split the invoice builder", status: "in_progress" },
        { step: "Update the tests", status: "pending" },
      ],
    };
    const { gateway, request } = createGateway(card);

    const first = mount(gateway);
    await waitForFast(() =>
      expect(first.textContent).toContain("Split the invoice builder · 1 of 3"),
    );
    expect(request).toHaveBeenCalledWith("progressCard.get", { sessionKey });

    // A reload builds the page again: the step comes back from the server, not from memory.
    document.body.replaceChildren();
    const { gateway: reloaded, request: reloadedRequest } = createGateway(card);
    const second = mount(reloaded);
    await waitForFast(() =>
      expect(second.textContent).toContain("Split the invoice builder · 1 of 3"),
    );
    expect(reloadedRequest).toHaveBeenCalledWith("progressCard.get", { sessionKey });
  });

  it("shows the status text while the session has no progress card", async () => {
    const { gateway, request } = createGateway(null);
    const element = mount(gateway);
    await waitForFast(() => expect(request).toHaveBeenCalled());
    expect(element.textContent).toBe("Running");
  });
});

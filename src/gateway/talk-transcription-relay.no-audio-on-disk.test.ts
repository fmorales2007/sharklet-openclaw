/**
 * Dictation keeps the text and drops the audio: the relay forwards chunks to the
 * provider session and never writes them anywhere on this host.
 */
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RealtimeTranscriptionProviderPlugin } from "../plugins/types.js";
import type { RealtimeTranscriptionSessionCreateRequest } from "../realtime-transcription/provider-types.js";
import { withOpenClawTestState } from "../test-utils/openclaw-test-state.js";
import {
  createTalkTranscriptionRelaySession,
  sendTalkTranscriptionRelayAudio,
  stopTalkTranscriptionRelaySession,
} from "./talk-transcription-relay.js";

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function filesUnder(dir: string): string[] {
  if (!fs.existsSync(dir)) {
    return [];
  }
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .flatMap((entry) =>
      entry.isDirectory() ? filesUnder(path.join(dir, entry.name)) : [path.join(dir, entry.name)],
    );
}

describe("talk transcription relay and audio retention", () => {
  it("forwards audio to the provider and leaves no audio bytes on disk", async () => {
    vi.useFakeTimers();
    await withOpenClawTestState({ scenario: "minimal" }, async (state) => {
      const audio = Buffer.from("audio-marker-never-on-disk-7f3a91");
      const writes = [
        vi.spyOn(fs, "writeFile"),
        vi.spyOn(fs, "writeFileSync"),
        vi.spyOn(fs, "appendFile"),
        vi.spyOn(fs, "appendFileSync"),
        vi.spyOn(fs, "createWriteStream"),
        vi.spyOn(fsp, "writeFile"),
        vi.spyOn(fsp, "appendFile"),
      ];
      let request: RealtimeTranscriptionSessionCreateRequest | undefined;
      const sttSession = {
        connect: vi.fn(async () => {}),
        sendAudio: vi.fn(),
        close: vi.fn(() => request?.onTranscript?.("hola mundo")),
        isConnected: vi.fn(() => true),
      };
      const provider: RealtimeTranscriptionProviderPlugin = {
        id: "stt-test",
        label: "STT Test",
        isConfigured: () => true,
        createSession: vi.fn((req) => {
          request = req;
          return sttSession;
        }),
      };
      const context = {
        getRuntimeConfig: () => ({}),
        logGateway: { warn: vi.fn() },
        broadcastToConnIds: vi.fn(),
      } as never;

      const session = createTalkTranscriptionRelaySession({
        context,
        connId: "conn-1",
        provider,
        providerConfig: { model: "stt-model" },
      });
      await Promise.resolve();
      for (let chunk = 0; chunk < 5; chunk += 1) {
        sendTalkTranscriptionRelayAudio({
          transcriptionSessionId: session.transcriptionSessionId,
          connId: "conn-1",
          audioBase64: audio.toString("base64"),
        });
      }
      stopTalkTranscriptionRelaySession({
        transcriptionSessionId: session.transcriptionSessionId,
        connId: "conn-1",
      });
      await vi.advanceTimersByTimeAsync(5_000);

      // The provider got the audio; the host kept nothing.
      expect(sttSession.sendAudio).toHaveBeenCalledTimes(5);
      expect(sttSession.sendAudio).toHaveBeenCalledWith(audio);
      for (const spy of writes) {
        expect(spy).not.toHaveBeenCalledWith(
          expect.anything(),
          expect.stringContaining("audio-marker"),
        );
      }
      const holders = [...filesUnder(state.stateDir), ...filesUnder(state.workspaceDir)].filter(
        (file) => fs.readFileSync(file).includes(audio),
      );
      expect(holders).toEqual([]);
    });
  });
});

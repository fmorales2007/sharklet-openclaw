// Sharklet Memory-less (ADR-006 §7). The flag is set once, by sessions.create,
// and read from the session row; sessions.patch has no field for it.
import type { SessionsCreateParams } from "../../../../packages/gateway-protocol/src/index.js";

/** What a row or entry carries; absent means an ordinary chat. */
export type MemorylessMark = { memoryless?: true };

export function isMemorylessSession(row: MemorylessMark | null | undefined): boolean {
  return row?.memoryless === true;
}

/** The only way the client asks for the flag: as a creation param. */
export function memorylessCreateParams(on: boolean): Pick<SessionsCreateParams, "memoryless"> {
  return on ? { memoryless: true } : {};
}

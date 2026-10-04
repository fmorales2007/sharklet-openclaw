import { UI_APPEARANCE_TYPEFACE_VALUES } from "../../../packages/gateway-protocol/src/schema/ui-appearance-preferences.ts";

// Sharklet's faces come from its tokens (custom/theme/bridge.css): Geist for
// UI and chat, Geist Mono for code. The typeface preference survives only as
// the stored/synced value the gateway wire contract carries; nothing applies it.
export type TypefaceId = (typeof UI_APPEARANCE_TYPEFACE_VALUES)[number];

// The wire contract owns storable overrides; browser and profile inputs must
// reject the same unknown values rather than turning them into CSS families.
export function normalizeTypefaceOverride(value: unknown): TypefaceId | undefined {
  return UI_APPEARANCE_TYPEFACE_VALUES.find((face) => face === value);
}

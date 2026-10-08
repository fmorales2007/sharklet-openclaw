import { normalizeControlUiBasePath } from "./control-ui-shared.js";

export const CONTROL_UI_BUILD_ID_ATTRIBUTE = "data-openclaw-control-ui-build-id";

/** Root files emitted by the Control UI build and served under any configured mount. */
export const CONTROL_UI_ROOT_PUBLIC_ASSETS = [
  "apple-touch-icon.png",
  // Sharklet: favicon-16 and the three PWA icons its manifest lists. The gateway
  // serves only what is on this list, and without them "Add to Home Screen"
  // gets 404s for every icon but the 180px one. Outside the UI whitelist, by
  // the owner's decision of 2026-09-21.
  "favicon-16.png",
  "favicon-32.png",
  "favicon.ico",
  "favicon.svg",
  "icon-192.png",
  "icon-512.png",
  "icon-512-maskable.png",
  "manifest.webmanifest",
  "sw.js",
] as const;
export type ControlUiRootPublicAsset = (typeof CONTROL_UI_ROOT_PUBLIC_ASSETS)[number];

export function isControlUiRootPublicAsset(value: string): value is ControlUiRootPublicAsset {
  return CONTROL_UI_ROOT_PUBLIC_ASSETS.some((asset) => asset === value);
}

/** Public build inputs covered by the document's content-bound cache identity. */
export function isControlUiVersionedPublicAsset(value: string): boolean {
  return (
    (isControlUiRootPublicAsset(value) && value !== "sw.js") ||
    /^(?:fonts\/[^/]+\.(?:css|woff2)|themes\/[^/]+\.css|(?:provider-icons|file-icons(?:\/[^/]+)*)\/[^/]+\.svg|(?:plugin-art|app-art|community-art)\/[^/]+\.webp)$/u.test(
      value,
    )
  );
}

export function buildControlUiRootAssetPath(
  basePath: string | null | undefined,
  asset: ControlUiRootPublicAsset,
): string {
  return `${normalizeControlUiBasePath(basePath)}/${asset}`;
}

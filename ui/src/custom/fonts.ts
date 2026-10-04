// Makes sure Geist is actually loaded.
//
// bridge.css points --font-body and --font-chat at "Geist", but the face only
// arrives if its stylesheet is linked. Upstream's per-theme typeface loader is
// gone with its themes (F1-10), so this is the only place that links one:
// through the public-asset path helper, idempotently.
//
// Geist came with upstream. Geist Mono is ours: the latin and latin-ext
// variable subsets, the same ranges geist.css uses, in ui/public/fonts/ with
// the same OFL text. It is not a selectable typeface upstream and does not need
// to be — --mono points at it directly — so only this link loads it.

import { inferControlUiPublicAssetPath } from "../app/public-assets.ts";

const SHEETS = ["fonts/geist.css", "fonts/geist-mono.css"] as const;

export function installSharkletFonts(): void {
  if (typeof document === "undefined") {
    return;
  }
  for (const asset of SHEETS) {
    const id = `sharklet-font-${asset.replace(/[^a-z0-9]+/gi, "-")}`;
    if (document.getElementById(id)) {
      continue;
    }
    // Preload first, stylesheet once it has arrived. installMissingStylesheetRecovery
    // (app/stale-chunk-reload.ts) treats ANY failed <link rel="stylesheet"> as
    // the app's CSS being broken: it schedules a reload and shows "Styles failed
    // to load". A missing font is not that — the stack falls back and the app is
    // fine — so a failed preload, which the guard ignores, is the right failure.
    const link = document.createElement("link");
    link.id = id;
    link.rel = "preload";
    link.as = "style";
    link.addEventListener(
      "load",
      () => {
        link.rel = "stylesheet";
      },
      { once: true },
    );
    link.href = inferControlUiPublicAssetPath(asset);
    document.head.append(link);
  }
}

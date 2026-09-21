// Makes sure Geist is actually loaded.
//
// bridge.css points --font-body and --font-chat at "Geist", but the face only
// arrives if its stylesheet is linked. Upstream links typeface stylesheets on
// demand (app/typography.ts:77), and only for the typeface the settings resolve
// to — which is Instrument Sans unless someone picked Geist by hand. Forcing the
// token without linking the sheet gives the system sans, not Geist.
//
// loadTypefaceStylesheet is not exported and typography.ts is outside the
// whitelist, so this links the same public asset itself, through the same path
// helper, with the same id shape, and is idempotent.
//
// Geist is already in the fork with its OFL licence (ui/public/fonts/). Geist
// Mono is NOT: the woff2 files still have to be subset and added, and until
// they are, --mono falls back to JetBrains Mono, which upstream self-hosts and
// always loads.

import { inferControlUiPublicAssetPath } from "../app/public-assets.ts";

const SHEETS = ["fonts/geist.css"] as const;

export function installSharkletFonts(): void {
  if (typeof document === "undefined") {
    return;
  }
  for (const asset of SHEETS) {
    const id = `sharklet-font-${asset.replace(/[^a-z0-9]+/gi, "-")}`;
    if (document.getElementById(id)) {
      continue;
    }
    const link = document.createElement("link");
    link.id = id;
    link.rel = "stylesheet";
    link.href = inferControlUiPublicAssetPath(asset);
    document.head.append(link);
  }
}

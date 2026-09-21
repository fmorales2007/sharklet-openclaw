// Sharklet's startup runtime: the pieces the CSS cannot do on its own, the fonts
// and the mascot. main.ts imports it; the theme stylesheet (custom/theme/index.css)
// is @imported at the end of styles.css instead, because only that keeps it in
// upstream's single startup CSS file. The motion runtime (motion.js) is not
// here either: the mascot loads it with the swim art, the first time a shark swims.
//
// It must be imported BEFORE ./app/app-host.ts. Two reasons:
//   - the mascot override wins by registering <openclaw-mascot> first, since
//     components/openclaw-mascot.ts:233 guards with
//     `if (!customElements.get("openclaw-mascot"))`. Registering afterwards
//     would mean patching the six places that mount it, all outside the
//     whitelist;
//   - the font link should be in <head> before the first paint.

import { installSharkletFonts } from "./fonts.ts";
import { defineSharkletMascot, replaceClawGlyph } from "./mascot.ts";

installSharkletFonts();
defineSharkletMascot();
replaceClawGlyph();

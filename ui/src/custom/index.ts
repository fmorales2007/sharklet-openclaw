// Sharklet: the one thing main.ts imports.
//
// The whitelist allows main.ts a single import line, so this module is it. It
// pulls in the stylesheet layer and starts the two runtime pieces the CSS
// cannot do on its own.
//
// It must be imported BEFORE ./app/app-host.ts. Two reasons:
//   - the mascot override wins by registering <openclaw-mascot> first, since
//     components/openclaw-mascot.ts:233 guards with
//     `if (!customElements.get("openclaw-mascot"))`. Registering afterwards
//     would mean patching the six places that mount it, all outside the
//     whitelist;
//   - the font link should be in <head> before the first paint.

import "./theme/index.css";
import { installSharkletFonts } from "./fonts.ts";
// motion.js is the synced copy of the approved runtime; see sync-to-fork.mjs.
import { initMotion } from "./motion.js";

installSharkletFonts();

// CSS cannot stop the shark: it swims with SMIL, and only pauseAnimations()
// stops that. initMotion follows the OS setting and the in-app one, reaches
// SVGs that appear later, and applies [data-effort]. Without it, motion.md is
// broken in silence on the loading screen — the first thing anyone sees.
initMotion();

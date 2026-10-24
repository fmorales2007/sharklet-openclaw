// Sharklet's startup runtime: the pieces the CSS cannot do on its own — the
// language default, the fonts and the shell (copy, help button, density).
// main.ts imports it; the theme stylesheet (custom/theme/index.css) is
// @imported at the end of styles.css instead, because only that keeps it in
// upstream's single startup CSS file. The motion runtime (motion.js) is not
// here either: the mascot loads it with the swim art, the first time a shark swims.
//
// It must be imported BEFORE ./app/app-host.ts, so the font link is in <head>
// before the first paint.

// First: it has to run before the i18n module reads the stored locale.
import "./locale.ts";
import { installSharkletFonts } from "./fonts.ts";
import { installSharkletShell } from "./shell.ts";

installSharkletFonts();
installSharkletShell();

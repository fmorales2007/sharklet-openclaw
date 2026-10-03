import { definePage } from "@openclaw/uirouter";
import { routePageSpec } from "../../app-route-paths.ts";
import type { ApplicationContext } from "../../app/context.ts";

// The composer under the board is the new-session one, so the page loads its data.
export const page = definePage({
  ...routePageSpec("home"),
  loader: async (context: ApplicationContext) =>
    (await import("../new-session/route-loader.ts")).load(context, ""),
  component: () => import("./mission-control-page-entry.ts"),
});

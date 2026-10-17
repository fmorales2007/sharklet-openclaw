import { definePage } from "@openclaw/uirouter";
import { html } from "lit";
import { routePageSpec } from "../../app-route-paths.ts";
import type { ApplicationContext } from "../../app/context.ts";

export const page = definePage({
  ...routePageSpec("you"),
  loader: (context: ApplicationContext) => {
    // The page needs the agent list before it can pick whose files to read.
    void context.agents.ensureList();
  },
  component: () =>
    import("./you-page.ts").then(() => ({
      header: true,
      render: () => html`<openclaw-you-page></openclaw-you-page>`,
    })),
});

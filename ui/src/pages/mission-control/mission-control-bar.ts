// The compact Mission Control strip in the header of every other page. It
// loads on demand from the shell, so the first paint does not carry it.
import { consume } from "@lit/context";
import { html } from "lit";
import { keyed } from "lit/directives/keyed.js";
import { applicationContext, type ApplicationContext } from "../../app/context.ts";
import { OpenClawLightDomElement } from "../../lit/openclaw-element.ts";
import "../../custom/theme/components.css";
import "./mission-control-strip.ts";
import { MissionControlSourcesController } from "./sources-controller.ts";

export class MissionControlBar extends OpenClawLightDomElement {
  @consume({ context: applicationContext, subscribe: true })
  private context?: ApplicationContext;

  private readonly sourcesController = new MissionControlSourcesController(
    this,
    () => this.context?.gateway,
  );

  override render() {
    return keyed(
      this.sourcesController.sources,
      html`<sharklet-mission-strip compact></sharklet-mission-strip>`,
    );
  }
}

customElements.define("sharklet-mission-bar", MissionControlBar);

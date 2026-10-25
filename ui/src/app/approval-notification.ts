import { t } from "../i18n/index.ts";
import { compactApprovalCommand, type ExecApprovalRequest } from "./exec-approval.ts";

/**
 * System notification for an approval that is waiting. Never asks for permission
 * (the composer's first send does, in a user gesture); stays quiet while the owner
 * is already looking at this tab.
 */
export function notifyApprovalArrival(approval: ExecApprovalRequest): void {
  if (
    typeof Notification === "undefined" ||
    Notification.permission !== "granted" ||
    (document.visibilityState === "visible" && document.hasFocus())
  ) {
    return;
  }
  try {
    const notification = new Notification(t("execApproval.needsYou"), {
      body:
        approval.kind === "exec"
          ? compactApprovalCommand(approval.request.command)
          : (approval.pluginTitle ?? compactApprovalCommand(approval.request.command)),
      tag: `approval:${approval.id}`,
    });
    // Clicking it brings the tab, and the card above the chat, back in front.
    notification.addEventListener("click", () => window.focus());
  } catch {
    // A blocked or unsupported notification must never interrupt the approval itself.
  }
}

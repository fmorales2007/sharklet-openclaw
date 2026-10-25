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
    new Notification(t("execApproval.needsYou"), {
      body:
        approval.kind === "exec"
          ? compactApprovalCommand(approval.request.command)
          : (approval.pluginTitle ?? compactApprovalCommand(approval.request.command)),
      tag: `approval:${approval.id}`,
    });
  } catch {
    // A blocked or unsupported notification must never interrupt the approval itself.
  }
}

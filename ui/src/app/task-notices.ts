import { t } from "../i18n/index.ts";
import { taskNotices } from "../lib/task-notices.ts";

const FINISHED_KEYS = {
  completed: "taskNotices.finished",
  failed: "taskNotices.failed",
  cancelled: "taskNotices.stopped",
  timed_out: "taskNotices.timedOut",
} as const;

// A task event can repeat for one outcome (retries, restores); notice each status once.
const noticedStatus = new Map<string, string>();
const NOTICED_LIMIT = 500;

/**
 * Turns a gateway `task` event that ends a task into a notice; every other event is ignored.
 * The task schema carries the protocol validators, so it loads on the first task event
 * instead of in the boot chunk.
 */
export async function observeTaskNotice(event: { event: string; payload?: unknown }) {
  if (event.event !== "task") {
    return;
  }
  const { normalizeTaskEventPayload, isActiveTask, taskTitle } =
    await import("../lib/tasks/data.ts");
  const payload = normalizeTaskEventPayload(event.payload);
  if (payload?.action !== "upserted" || isActiveTask(payload.task)) {
    return;
  }
  const { task } = payload;
  if (noticedStatus.get(task.id) === task.status) {
    return;
  }
  if (noticedStatus.size >= NOTICED_LIMIT) {
    noticedStatus.clear();
  }
  noticedStatus.set(task.id, task.status);
  taskNotices.push({
    id: `${task.id}:${task.status}`,
    title: t(FINISHED_KEYS[task.status as keyof typeof FINISHED_KEYS], { title: taskTitle(task) }),
    tone: task.status === "completed" ? "done" : "problem",
  });
}

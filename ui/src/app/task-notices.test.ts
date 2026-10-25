import { afterEach, describe, expect, it } from "vitest";
import { taskNotices } from "../lib/task-notices.ts";
import { observeTaskNotice } from "./task-notices.ts";

const task = (id: string, status: string) => ({
  event: "task",
  payload: { action: "upserted", task: { id, status, title: `Job ${id}` } },
});

afterEach(() => taskNotices.clearHistory());

describe("observeTaskNotice", () => {
  it("notices a task once when it ends and ignores running tasks and other events", async () => {
    await observeTaskNotice(task("t1", "running"));
    await observeTaskNotice({ event: "chat", payload: {} });
    expect(taskNotices.snapshot.history).toEqual([]);

    await observeTaskNotice(task("t1", "completed"));
    await observeTaskNotice(task("t1", "completed"));
    expect(taskNotices.snapshot.history.map((n) => [n.title, n.tone])).toEqual([
      ["Job t1 finished", "done"],
    ]);
  });

  it("words failures and marks them as problems", async () => {
    await observeTaskNotice(task("t2", "failed"));
    expect(taskNotices.snapshot.history[0]).toMatchObject({
      title: "Job t2 failed",
      tone: "problem",
    });
  });
});

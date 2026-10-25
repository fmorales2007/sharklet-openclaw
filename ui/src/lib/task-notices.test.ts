import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TaskNoticeStore } from "./task-notices.ts";

describe("TaskNoticeStore", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const notice = (n: number) => ({
    id: `task-${n}`,
    title: `Task ${n} finished`,
    tone: "done" as const,
  });

  it("shows three at most, each for six seconds, and keeps all five in the history", () => {
    const store = new TaskNoticeStore();
    for (let n = 1; n <= 5; n += 1) {
      store.push(notice(n));
    }
    expect(store.snapshot.visible.map((item) => item.id)).toEqual(["task-3", "task-4", "task-5"]);
    expect(store.snapshot.history.map((item) => item.id)).toEqual([
      "task-5",
      "task-4",
      "task-3",
      "task-2",
      "task-1",
    ]);
    expect(store.snapshot.unread).toBe(5);

    vi.advanceTimersByTime(5_999);
    expect(store.snapshot.visible).toHaveLength(3);
    vi.advanceTimersByTime(1);
    expect(store.snapshot.visible).toEqual([]);
    expect(store.snapshot.history).toHaveLength(5);
  });

  it("counts six seconds from each notice's own arrival", () => {
    const store = new TaskNoticeStore();
    store.push(notice(1));
    vi.advanceTimersByTime(4_000);
    store.push(notice(2));
    vi.advanceTimersByTime(2_000);
    expect(store.snapshot.visible.map((item) => item.id)).toEqual(["task-2"]);
    vi.advanceTimersByTime(4_000);
    expect(store.snapshot.visible).toEqual([]);
  });

  it("restarts the clock when the same notice arrives again and lists it once", () => {
    const store = new TaskNoticeStore();
    store.push(notice(1));
    vi.advanceTimersByTime(5_000);
    store.push(notice(1));
    vi.advanceTimersByTime(5_000);
    expect(store.snapshot.visible).toHaveLength(1);
    expect(store.snapshot.history).toHaveLength(1);
  });

  it("clears unread on markRead, lets a notice be dismissed early, and tells subscribers", () => {
    const store = new TaskNoticeStore();
    const listener = vi.fn();
    store.subscribe(listener);
    store.push(notice(1));
    store.dismiss("task-1");
    expect(store.snapshot.visible).toEqual([]);
    expect(store.snapshot.unread).toBe(1);
    store.markRead();
    expect(store.snapshot.unread).toBe(0);
    expect(listener).toHaveBeenCalledTimes(3);
  });

  it("caps the history", () => {
    const store = new TaskNoticeStore();
    for (let n = 1; n <= 60; n += 1) {
      store.push(notice(n));
    }
    expect(store.snapshot.history).toHaveLength(50);
    expect(store.snapshot.history[0]?.id).toBe("task-60");
  });
});

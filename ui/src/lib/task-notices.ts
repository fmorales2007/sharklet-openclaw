// Finished-task notices: at most three on screen, each leaves after six seconds,
// and every one stays in the bell's history. Separate from the shared toast, which
// shows one message at a time and replaces it.
export type TaskNotice = {
  id: string;
  title: string;
  tone: "done" | "problem";
  at: number;
};

const MAX_VISIBLE = 3;
const VISIBLE_MS = 6_000;
const HISTORY_LIMIT = 50;

export type TaskNoticeSnapshot = {
  visible: readonly TaskNotice[];
  history: readonly TaskNotice[];
  unread: number;
};

export class TaskNoticeStore {
  private visible: TaskNotice[] = [];
  private history: TaskNotice[] = [];
  private unread = 0;
  private snapshotCache: TaskNoticeSnapshot | null = null;
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly listeners = new Set<() => void>();

  get snapshot(): TaskNoticeSnapshot {
    this.snapshotCache ??= { visible: this.visible, history: this.history, unread: this.unread };
    return this.snapshotCache;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  push(notice: Omit<TaskNotice, "at">): void {
    const entry: TaskNotice = { ...notice, at: Date.now() };
    this.history = [entry, ...this.history.filter((item) => item.id !== entry.id)].slice(
      0,
      HISTORY_LIMIT,
    );
    this.unread += 1;
    const next = [...this.visible.filter((item) => item.id !== entry.id), entry];
    for (const evicted of next.splice(0, Math.max(0, next.length - MAX_VISIBLE))) {
      this.clearTimer(evicted.id);
    }
    this.visible = next;
    this.clearTimer(entry.id);
    this.timers.set(
      entry.id,
      setTimeout(() => this.dismiss(entry.id), VISIBLE_MS),
    );
    this.emit();
  }

  dismiss(id: string): void {
    this.clearTimer(id);
    if (this.visible.some((item) => item.id === id)) {
      this.visible = this.visible.filter((item) => item.id !== id);
      this.emit();
    }
  }

  markRead(): void {
    if (this.unread > 0) {
      this.unread = 0;
      this.emit();
    }
  }

  clearHistory(): void {
    this.history = [];
    this.unread = 0;
    this.emit();
  }

  private clearTimer(id: string) {
    const timer = this.timers.get(id);
    if (timer !== undefined) {
      clearTimeout(timer);
      this.timers.delete(id);
    }
  }

  private emit() {
    this.snapshotCache = null;
    for (const listener of this.listeners) {
      listener();
    }
  }
}

export const taskNotices = new TaskNoticeStore();

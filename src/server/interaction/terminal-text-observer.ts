import type { PreviewListener, PreviewSubscription } from "./tmux-preview-listener.js";
import type { TmuxBinding } from "./transport.js";

/** Notification-driven reads: fixed merge windows, one read at a time, explicit disposal. */
export class TerminalTextObserver {
  readonly ready: Promise<void>;
  private subscription?: PreviewSubscription;
  private timer?: ReturnType<typeof setTimeout>;
  private task?: Promise<void>;
  private dirty = false;
  private listening = false;
  private disposed = false;

  constructor(
    binding: TmuxBinding,
    listen: PreviewListener,
    private readonly read: () => Promise<void>,
    private readonly fail: (error: unknown) => void,
  ) {
    this.subscription = listen(
      binding,
      () => {
        if (this.disposed) return;
        this.dirty = true;
        this.schedule();
      },
      (error) => this.failure(error),
    );
    if (this.disposed) this.subscription.close();
    this.ready = this.subscription.ready.then(() => {
      this.listening = true;
      this.schedule();
    });
    void this.ready.catch((error: unknown) => this.failure(error));
  }

  capture(): Promise<void> {
    if (this.task) return this.task;
    if (this.disposed) return Promise.resolve();
    clearTimeout(this.timer);
    this.timer = undefined;
    this.dirty = false;
    this.task = Promise.resolve()
      .then(() => {
        if (!this.disposed) return this.read();
      })
      .catch((error: unknown) => {
        this.failure(error);
        throw error;
      })
      .finally(() => {
        this.task = undefined;
        if (this.dirty) this.schedule();
      });
    return this.task;
  }

  /** Freeze notifications at the deadline, then drain the outstanding work. */
  async flush(): Promise<void> {
    this.listening = false;
    clearTimeout(this.timer);
    this.timer = undefined;
    const pending = this.dirty;
    this.dirty = false;
    await this.task;
    if (pending) await this.capture();
  }

  close(): void {
    if (this.disposed) return;
    this.disposed = true;
    clearTimeout(this.timer);
    this.timer = undefined;
    this.subscription?.close();
  }

  private schedule(): void {
    if (!this.listening || this.disposed || this.task || this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.capture().catch(() => {});
    }, 350);
  }

  private failure(error: unknown): void {
    if (this.disposed) return;
    this.close();
    this.fail(error);
  }
}

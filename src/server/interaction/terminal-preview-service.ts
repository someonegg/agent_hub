import { createHash, randomUUID } from "node:crypto";

import type { TerminalPreviewFrame, TerminalPreviewSnapshot } from "../../shared/api-contract.js";
import { diffLines } from "./terminal-preview-diff.js";
import { TerminalTextObserver } from "./terminal-text-observer.js";
import { createTmuxPreviewListener, type PreviewListener } from "./tmux-preview-listener.js";
import type { TmuxBinding } from "./transport.js";

interface Viewer {
  assertOwner(): void;
  frame(value: TerminalPreviewFrame): void;
  fail(error: unknown): void;
  close(): void;
  initialized: boolean;
}
interface State {
  key: string;
  binding: TmuxBinding;
  viewers: Set<Viewer>;
  observer?: TerminalTextObserver;
  snapshot?: TerminalPreviewSnapshot;
  disposed: boolean;
}

export class TerminalPreviewService {
  readonly #states = new Map<string, State>();
  readonly #identity = randomUUID();
  #closed = false;

  constructor(
    private readonly capture: (
      binding: TmuxBinding,
      assertOwner: () => void,
    ) => Promise<{ content: string; truncated: boolean }>,
    private readonly listen: PreviewListener = createTmuxPreviewListener(),
  ) {}

  async captureFresh(binding: TmuxBinding, assertOwner: () => void) {
    assertOwner();
    const result = await this.capture(binding, assertOwner);
    assertOwner();
    return { ...result, capturedAt: new Date().toISOString() };
  }

  subscribe(
    binding: TmuxBinding,
    assertOwner: () => void,
    frame: (value: TerminalPreviewFrame) => void,
    fail: (error: unknown) => void,
    signal: AbortSignal,
  ): () => void {
    if (this.#closed || signal.aborted) throw new DOMException("Aborted", "AbortError");
    const key = JSON.stringify([binding.socketPath, binding.sessionName]);
    let state = this.#states.get(key);
    const fresh = !state;
    if (!state) {
      state = { key, binding, viewers: new Set(), disposed: false };
      this.#states.set(key, state);
    }
    const current = state;
    const close = () => {
      signal.removeEventListener("abort", close);
      current.viewers.delete(viewer);
      if (!current.viewers.size) this.#dispose(current);
    };
    const viewer: Viewer = { assertOwner, frame, fail, close, initialized: false };
    current.viewers.add(viewer);
    signal.addEventListener("abort", close, { once: true });
    try {
      assertOwner();
      if (fresh) {
        current.observer = new TerminalTextObserver(
          binding,
          this.listen,
          () => this.#capture(current),
          (error) => this.#fail(current, error),
        );
        if (current.disposed) current.observer.close();
      }
      void current
        .observer!.ready.then(async () => {
          if (current.disposed || !current.viewers.has(viewer)) return;
          if (!current.snapshot) await current.observer!.capture();
          if (current.disposed || !current.viewers.has(viewer)) return;
          assertOwner();
          if (!viewer.initialized) {
            viewer.initialized = true;
            frame({ type: "snapshot", ...current.snapshot! });
          }
        })
        .catch((error: unknown) => this.#fail(current, error));
    } catch (error) {
      this.#fail(current, error);
    }
    return close;
  }

  invalidate(): void {
    for (const state of this.#states.values()) {
      try {
        this.#assertOwner(state);
      } catch (error) {
        this.#fail(state, error);
      }
    }
  }

  close(): void {
    this.#closed = true;
    for (const state of this.#states.values())
      this.#fail(state, new DOMException("Aborted", "AbortError"));
  }

  #assertOwner(state: State): void {
    if (state.disposed) throw new DOMException("Aborted", "AbortError");
    for (const viewer of state.viewers) viewer.assertOwner();
  }

  async #capture(state: State): Promise<void> {
    const result = await this.captureFresh(state.binding, () => this.#assertOwner(state));
    const previous = state.snapshot;
    if (previous && previous.content === result.content && previous.truncated === result.truncated)
      return;
    const snapshot: TerminalPreviewSnapshot = {
      ...result,
      revision: createHash("sha256")
        .update(JSON.stringify([this.#identity, state.key, result.content, result.truncated]))
        .digest("base64url"),
    };
    state.snapshot = snapshot;
    const full: TerminalPreviewFrame = { type: "snapshot", ...snapshot };
    let update: TerminalPreviewFrame = full;
    if (previous) {
      const operations = diffLines(previous.content, snapshot.content);
      if (operations !== null) {
        const delta: TerminalPreviewFrame = {
          type: "delta",
          baseRevision: previous.revision,
          revision: snapshot.revision,
          operations,
          truncated: snapshot.truncated,
          capturedAt: snapshot.capturedAt,
        };
        const size = bytes(delta);
        if (size <= 8192 && size < bytes(full)) update = delta;
      }
    }
    for (const viewer of [...state.viewers]) {
      if (!state.viewers.has(viewer)) continue;
      viewer.assertOwner();
      const message = viewer.initialized ? update : full;
      viewer.initialized = true;
      viewer.frame(message);
    }
  }

  #fail(state: State, error: unknown): void {
    if (state.disposed) return;
    const viewers = [...state.viewers];
    this.#dispose(state);
    for (const viewer of viewers) {
      viewer.close();
      viewer.fail(error);
    }
  }

  #dispose(state: State): void {
    if (state.disposed) return;
    state.disposed = true;
    state.observer?.close();
    if (this.#states.get(state.key) === state) this.#states.delete(state.key);
  }
}

function bytes(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value), "utf8");
}

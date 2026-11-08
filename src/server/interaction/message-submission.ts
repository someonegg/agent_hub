import { TerminalTextObserver } from "./terminal-text-observer.js";
import type { PreviewListener } from "./tmux-preview-listener.js";
import type { MessageSubmissionOptions, TmuxBinding } from "./transport.js";

export function confirmMessageSubmission(
  binding: TmuxBinding,
  listen: PreviewListener,
  notSubmitted: () => Error,
): MessageSubmissionOptions {
  return {
    async prepare(read) {
      let baseline: string | undefined;
      let changed = false;
      let failure: unknown;
      let resolve!: () => void;
      let reject!: (error: unknown) => void;
      const result = new Promise<void>((yes, no) => {
        resolve = yes;
        reject = no;
      });
      void result.catch(() => {});
      const observer = new TerminalTextObserver(
        binding,
        listen,
        async () => {
          const latest = await read();
          if (baseline === undefined) baseline = latest.content;
          else if (latest.content !== baseline) {
            changed = true;
            resolve();
          }
        },
        (error) => {
          failure = error;
          reject(error);
        },
      );
      let timer: ReturnType<typeof setTimeout> | undefined;
      const close = () => {
        clearTimeout(timer);
        observer.close();
      };
      try {
        await Promise.race([observer.ready, result]);
        await observer.capture();
        if (failure) throw failure;
        return {
          async confirm() {
            if (failure) throw failure;
            if (changed) return;
            timer = setTimeout(() => {
              void observer.flush().then(() => {
                if (failure) reject(failure);
                else if (!changed) reject(notSubmitted());
              }, reject);
            }, 2000);
            await result;
          },
          close,
        };
      } catch (error) {
        close();
        throw error;
      }
    },
  };
}

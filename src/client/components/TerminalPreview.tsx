import { type KeyboardEvent, useLayoutEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import type { InteractionKey, TerminalPreviewSnapshot } from "../../shared/api-contract";

import { type PlainMessageKey, t } from "../i18n";
import { RequestError } from "./RequestError";
import { isNearScrollEnd } from "./scroll-position";

export function TerminalPreview({
  preview,
  previewBusy,
  previewStopped,
  previewError,
  previewErrorDetail,
  previewExpanded,
  contentId,
  busy,
  onSendKeys,
  onRetry,
  onToggle,
}: {
  preview: TerminalPreviewSnapshot | null;
  previewBusy: boolean;
  previewStopped: boolean;
  previewError: string | null;
  previewErrorDetail?: unknown;
  previewExpanded: boolean;
  contentId: string;
  busy: boolean;
  onSendKeys: (keys: readonly InteractionKey[]) => Promise<void>;
  onRetry: () => void;
  onToggle: () => void;
}) {
  useTranslation();
  const [keyError, setKeyError] = useState<unknown>(null);
  const followOutput = useRef(true);
  const scrollOnExpand = useRef(true);
  const previewContent = useRef<HTMLPreElement | null>(null);
  const keyGeneration = useRef(0);
  useLayoutEffect(() => {
    const generation = ++keyGeneration.current;
    if (!previewExpanded) setKeyError(null);
    return () => {
      keyGeneration.current = generation + 1;
    };
  }, [previewExpanded]);
  const sendKey = async (key: InteractionKey) => {
    if (busy) return;
    const generation = keyGeneration.current;
    setKeyError(null);
    try {
      await onSendKeys([key]);
    } catch (error) {
      if (generation === keyGeneration.current) setKeyError(error);
    }
  };
  useLayoutEffect(() => {
    if (!previewExpanded) {
      scrollOnExpand.current = true;
      return;
    }
    if (preview === null) return;
    const content = previewContent.current;
    if (content === null) return;
    if (scrollOnExpand.current || followOutput.current) {
      content.scrollTop = content.scrollHeight;
      scrollOnExpand.current = false;
    }
  }, [preview, previewExpanded]);
  const onPreviewKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (
      !previewExpanded ||
      event.altKey ||
      event.metaKey ||
      event.shiftKey ||
      event.nativeEvent.isComposing ||
      event.nativeEvent.keyCode === 229
    )
      return;
    if (event.ctrlKey) {
      if (event.key.toLowerCase() !== "c") return;
      event.preventDefault();
      void sendKey("interrupt");
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      onToggle();
      return;
    }
    if (
      event.target instanceof Element &&
      event.target.closest("summary, details, .terminal-preview-notice button")
    )
      return;
    const key = PREVIEW_KEYS[event.key];
    if (!key) return;
    event.preventDefault();
    void sendKey(key);
  };

  return (
    <section
      hidden={!previewExpanded}
      className="terminal-preview"
      aria-label={t("terminalPreview")}
    >
      {previewExpanded ? (
        <div
          id={contentId}
          className="terminal-preview-body"
          tabIndex={0}
          onKeyDown={onPreviewKeyDown}
          onClick={(event) => {
            if (
              !(event.target instanceof Element) ||
              !event.target.closest("button, pre, summary, details")
            )
              event.currentTarget.focus();
          }}
        >
          {previewStopped || previewError ? (
            <div className="terminal-preview-notice" role="status">
              <span>{previewStopped ? t("previewUpdatesStopped") : t("reconnecting")}</span>
              {previewStopped ? (
                <button type="button" onClick={onRetry} disabled={previewBusy}>
                  {t("retryPreview")}
                </button>
              ) : null}
              {previewError ? (
                <details>
                  <summary>{t("requestDetails")}</summary>
                  <RequestError error={previewErrorDetail ?? previewError} />
                </details>
              ) : null}
            </div>
          ) : null}
          {keyError ? (
            <div className="terminal-preview-notice" role="alert">
              <RequestError error={keyError} />
              <button
                type="button"
                aria-label={t("dismissTerminalPreviewError")}
                onClick={() => setKeyError(null)}
              >
                ×
              </button>
            </div>
          ) : null}
          {preview?.truncated ? (
            <p className="terminal-preview-notice">
              {t("terminalOutputExceededThePreviewLimitTheBeginningWasOmitted")}
            </p>
          ) : null}
          {preview && preview.content.length > 0 ? (
            <pre
              onScroll={(event) => {
                followOutput.current = isNearScrollEnd(event.currentTarget);
              }}
              ref={previewContent}
              aria-label={t("terminalPreviewContent")}
              tabIndex={0}
            >
              <span key={preview.capturedAt} className="terminal-preview-content">
                {preview.content}
              </span>
            </pre>
          ) : previewStopped || previewError ? null : (
            <p className="terminal-preview-empty">
              {preview === null && previewBusy
                ? t("capturingTerminalPane")
                : preview === null
                  ? t("terminalPreviewUnavailable")
                  : t("theTerminalPaneIsEmpty")}
            </p>
          )}
          <div className="terminal-keypad" role="group" aria-label={t("terminalControls")}>
            {TERMINAL_CONTROL_KEYS.map(({ key, label, glyph }) => (
              <button
                key={key}
                type="button"
                className={`terminal-key terminal-key-${key}`}
                tabIndex={-1}
                aria-label={t(label)}
                aria-disabled={busy}
                onClick={() => void sendKey(key)}
              >
                <span aria-hidden="true">{glyph}</span>
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </section>
  );
}
const PREVIEW_KEYS: Readonly<Record<string, InteractionKey | undefined>> = {
  "0": "0",
  "1": "1",
  "2": "2",
  "3": "3",
  "4": "4",
  "5": "5",
  "6": "6",
  "7": "7",
  "8": "8",
  "9": "9",
  Enter: "enter",
  ArrowUp: "up",
  ArrowDown: "down",
  ArrowLeft: "left",
  ArrowRight: "right",
};

const TERMINAL_CONTROL_KEYS: ReadonlyArray<{
  readonly key: Extract<InteractionKey, "up" | "down" | "left" | "right" | "enter" | "BTab">;
  readonly label: PlainMessageKey;
  readonly glyph: string;
}> = [
  { key: "enter", label: "enter", glyph: "Enter" },
  { key: "up", label: "up", glyph: "↑" },
  { key: "BTab", label: "BTab", glyph: "BTab" },
  { key: "left", label: "left", glyph: "←" },
  { key: "down", label: "down", glyph: "↓" },
  { key: "right", label: "right", glyph: "→" },
];

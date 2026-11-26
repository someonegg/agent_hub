import { type ComponentProps, type ReactNode, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { copyText } from "../copy-text";
import { t } from "../i18n";
import { CheckIcon, CopyIcon } from "./CopyIcon";

const FEEDBACK_RESET_MS = 2000;

export function MarkdownCodeBlock({
  children,
  code,
  language,
  preProps,
}: {
  children: ReactNode;
  code?: string;
  language?: string | null;
  preProps: ComponentProps<"pre">;
}) {
  useTranslation();
  const [feedback, setFeedback] = useState<"copied" | "copyFailed" | null>(null);
  const preRef = useRef<HTMLPreElement>(null);
  const mounted = useRef(true);
  const resetTimer = useRef<number | null>(null);
  const copyLabel = t("copyCode");

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (resetTimer.current !== null) window.clearTimeout(resetTimer.current);
    };
  }, []);

  function handleCopy() {
    const text = code ?? (preRef.current?.textContent ?? "").replace(/\n$/, "");
    void copyText(text).then((copied) => {
      if (!mounted.current) return;
      setFeedback(copied ? "copied" : "copyFailed");
      if (resetTimer.current !== null) window.clearTimeout(resetTimer.current);
      resetTimer.current = window.setTimeout(() => {
        resetTimer.current = null;
        setFeedback(null);
      }, FEEDBACK_RESET_MS);
    });
  }

  return (
    <div className="markdown-code-block">
      <div className="markdown-code-header">
        <span className="markdown-code-lang">{language ?? ""}</span>
        <div className="markdown-code-actions">
          <span className="markdown-code-feedback" role="status">
            {feedback ? t(feedback) : null}
          </span>
          <button
            type="button"
            className="markdown-code-copy"
            aria-label={copyLabel}
            title={copyLabel}
            onClick={handleCopy}
          >
            {feedback === "copied" ? <CheckIcon /> : <CopyIcon />}
          </button>
        </div>
      </div>
      <div
        className="markdown-scroll-region markdown-scroll-code"
        role="region"
        aria-label={t("scrollableCodeBlock")}
        tabIndex={0}
      >
        <pre {...preProps} ref={preRef}>
          {children}
        </pre>
      </div>
    </div>
  );
}

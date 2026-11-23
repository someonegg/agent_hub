import { useState } from "react";
import { useTranslation } from "react-i18next";

import { t } from "../i18n";

const copyFailed = "copyFailedSelectTheCommandAndCopyItManually";
type CopyMessage = "" | "copied" | typeof copyFailed;

export function AttachCommand({ command }: { command: string }) {
  useTranslation();
  const [message, setMessage] = useState<CopyMessage>("");
  const copyLabel = t("copyCommand");

  function copyCommand() {
    const clipboard = navigator.clipboard;
    if (!clipboard) {
      setMessage(copyFailed);
      return;
    }
    void clipboard.writeText(command).then(
      () => setMessage("copied"),
      () => setMessage(copyFailed),
    );
  }

  return (
    <div className="attach-command">
      <p className="session-meta">
        {t("tmuxAccess")}{" "}
        <button type="button" aria-label={copyLabel} title={copyLabel} onClick={copyCommand}>
          <svg
            aria-hidden="true"
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <rect x="8" y="8" width="12" height="12" rx="2" />
            <path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" />
          </svg>
        </button>{" "}
        <code>{command}</code>
      </p>
      {message ? <small role="status">{t(message)}</small> : null}
    </div>
  );
}

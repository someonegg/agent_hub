import { useState } from "react";
import { useTranslation } from "react-i18next";

import { t } from "../i18n";
import { CopyIcon } from "./CopyIcon";

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
          <CopyIcon />
        </button>{" "}
        <code>{command}</code>
      </p>
      {message ? <small role="status">{t(message)}</small> : null}
    </div>
  );
}

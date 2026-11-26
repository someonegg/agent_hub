import { useState } from "react";
import { useTranslation } from "react-i18next";

import { copyText } from "../copy-text";
import { t } from "../i18n";
import { CopyIcon } from "./CopyIcon";

type CopyMessage = "" | "copied" | "copyFailed";

export function AttachCommand({ command }: { command: string }) {
  useTranslation();
  const [message, setMessage] = useState<CopyMessage>("");
  const copyLabel = t("copyCommand");

  function copyCommand() {
    void copyText(command).then((copied) => setMessage(copied ? "copied" : "copyFailed"));
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

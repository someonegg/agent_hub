import { type ReactNode, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";

import { copyText } from "../copy-text";
import { t } from "../i18n";
import { CopyIcon } from "./CopyIcon";

export function MarkdownLinkAddress({
  children,
  label,
  url,
}: {
  children: ReactNode;
  label: string;
  url: string;
}) {
  useTranslation();
  const [open, setOpen] = useState(false);
  const [feedback, setFeedback] = useState<"copied" | "copyFailed" | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const title = label || t("viewLinkAddress");

  useEffect(() => {
    if (open) dialog.current?.showModal();
  }, [open]);

  function openAddress() {
    setFeedback(null);
    setOpen(true);
  }

  async function copyAddress() {
    setFeedback((await copyText(url)) ? "copied" : "copyFailed");
  }

  return (
    <>
      <span
        role="button"
        tabIndex={0}
        className="markdown-link-trigger"
        aria-haspopup="dialog"
        onClick={openAddress}
        onKeyDown={(event) => {
          if (event.key === " " || event.key === "Enter") event.preventDefault();
          if (event.key === "Enter" && !event.repeat) openAddress();
        }}
        onKeyUp={(event) => {
          if (event.key === " ") {
            event.preventDefault();
            openAddress();
          }
        }}
      >
        {label ? children : title}
      </span>
      {open &&
        createPortal(
          <dialog
            ref={dialog}
            className="markdown-link-dialog"
            aria-labelledby={titleId}
            onClose={() => setOpen(false)}
          >
            <div className="markdown-link-dialog-header">
              <h2 id={titleId}>{title}</h2>
              <button
                type="button"
                aria-label={t("closeLinkAddress")}
                title={t("closeLinkAddress")}
                onClick={() => dialog.current?.close()}
              >
                <span aria-hidden="true">×</span>
              </button>
            </div>
            <div className="markdown-link-address">
              <code>{url}</code>
              <button
                type="button"
                aria-label={t("copyLink")}
                title={t("copyLink")}
                onClick={copyAddress}
              >
                <CopyIcon />
              </button>
            </div>
            <small role="status">{feedback ? t(feedback) : null}</small>
          </dialog>,
          document.body,
        )}
    </>
  );
}

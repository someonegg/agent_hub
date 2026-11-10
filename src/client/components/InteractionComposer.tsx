import type { ReactNode } from "react";
import { type KeyboardEvent, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { type InteractionKey, MAX_INTERACTION_MESSAGE_BYTES } from "../../shared/api-contract";

import { formatNumber, t } from "../i18n";
import { LocalizedError } from "../i18n/localized-error";
import { usePreferences } from "../state/preferences";
import { useSessionDraft } from "../state/session-drafts";
import { useAttachmentUpload } from "../state/use-attachment-upload";
import { AttachmentList } from "./AttachmentList";
import { AttachmentMenu } from "./AttachmentMenu";
import { RequestError } from "./RequestError";

export function InteractionComposer({
  sessionId,
  interactionAvailable,
  actionsDisabled,
  interactionSending = false,
  composerExpanded,
  composerFocusRequest,
  previewExpanded,
  error,
  errorDetail,
  onDismissError,
  onSendMessage,
  onSendKeys,
  onHandoffPaneBinding,
  onExpandPreview,
  scrollToEnd,
}: {
  sessionId: string;
  interactionAvailable: boolean;
  actionsDisabled: boolean;
  interactionSending?: boolean;
  composerExpanded: boolean;
  composerFocusRequest: number;
  previewExpanded: boolean;
  error: string | null;
  errorDetail?: unknown;
  onDismissError: () => void;
  onSendMessage: (message: string) => Promise<void>;
  onSendKeys: (keys: readonly InteractionKey[]) => Promise<void>;
  onHandoffPaneBinding: () => Promise<void>;
  onExpandPreview: () => void;
  scrollToEnd: () => void;
}) {
  useTranslation();
  const { enterToSend } = usePreferences();
  const previewIsExpanded = useRef(previewExpanded);
  previewIsExpanded.current = previewExpanded;
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const { message, setMessage, attachments, addAttachment, removeAttachment, clearSentMessage } =
    useSessionDraft(sessionId);
  const composer = useRef<HTMLTextAreaElement | null>(null);
  useEffect(() => {
    if (composerFocusRequest > 0) composer.current?.focus();
  }, [composerFocusRequest]);
  useEffect(() => {
    const blurWhenHidden = () => {
      if (document.hidden && document.activeElement === composer.current) composer.current?.blur();
    };
    document.addEventListener("visibilitychange", blurWhenHidden);
    return () => document.removeEventListener("visibilitychange", blurWhenHidden);
  }, []);
  const [dragging, setDragging] = useState(false);
  const interactionBlocked = actionsDisabled || interactionSending;
  const {
    uploadFiles: startUpload,
    uploadProgress,
    uploadError,
    setUploadError,
    isUploading,
  } = useAttachmentUpload(sessionId, interactionAvailable, interactionBlocked, addAttachment);
  const inputActionsDisabled = !interactionAvailable || actionsDisabled || !!uploadProgress;
  const inputBlocked = () => !interactionAvailable || interactionBlocked || isUploading();
  const uploadFiles = async (files: File[]) => {
    if (!files.length || inputBlocked()) return;
    setDragging(false);
    if (!(await startUpload(files))) return;
    requestAnimationFrame(() => {
      if (mounted.current && !composer.current?.closest("[hidden]")) composer.current?.focus();
    });
  };
  const attachmentLines = attachments.map(
    ({ path }) => `- ${/[\s"'\\]/.test(path) ? JSON.stringify(path) : path}`,
  );
  const outgoingMessage = attachmentLines.length
    ? attachmentLines.join("\n") + (message.length ? "\n\n" + message : "")
    : message;
  const messageBytes = new TextEncoder().encode(outgoingMessage.replace(/\r\n?/g, "\n")).byteLength;
  const messageTooLarge = messageBytes > MAX_INTERACTION_MESSAGE_BYTES;
  const messageIsBlank = !attachments.length && message.trim().length === 0;
  const send = async () => {
    if (inputBlocked() || messageIsBlank || messageTooLarge) return;
    const command = message.trimEnd();
    const shouldExpandPreview =
      !attachments.length &&
      /^\/[A-Za-z]+$/.test(command) &&
      command !== "/exit" &&
      command !== "/quit";
    await onSendMessage(outgoingMessage);
    clearSentMessage();
    requestAnimationFrame(() => {
      if (mounted.current) scrollToEnd();
    });
    if (!mounted.current || !shouldExpandPreview || previewIsExpanded.current) return;
    onExpandPreview();
  };
  const handoff = async () => {
    if (inputBlocked()) return;
    await onHandoffPaneBinding();
  };
  const interrupt = () => {
    if (inputBlocked()) return;
    onExpandPreview();
    void onSendKeys(["interrupt"]).catch(() => undefined);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    // WebKit may report IME-confirming keys after composition has ended.
    if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
    if (event.key !== "Enter" || (enterToSend ? event.shiftKey : !event.shiftKey)) return;
    event.preventDefault();
    if (event.repeat) return;
    void send().catch(() => undefined);
  };
  return (
    <AttachmentMenu
      interactionAvailable={interactionAvailable}
      actionsDisabled={actionsDisabled}
      interactionSending={interactionSending}
      uploadProgress={uploadProgress}
      onFiles={(files) => void uploadFiles(files)}
      onError={setUploadError}
    >
      {(attachmentMenu) => (
        <>
          {error ? (
            <div className="interaction-error" role="alert">
              <span>
                <RequestError error={errorDetail ?? error} />
              </span>
              <button
                type="button"
                onClick={onDismissError}
                aria-label={t("dismissInteractionError")}
              >
                ×
              </button>
            </div>
          ) : null}
          {uploadProgress ? (
            <p className="interaction-upload-progress" role="status">
              {uploadProgress}
            </p>
          ) : null}
          {uploadError ? (
            <div className="interaction-error" role="alert">
              <span>
                <RequestError error={uploadError} />
              </span>
              <button
                type="button"
                aria-label={t("dismissUploadError")}
                onClick={() => setUploadError(null)}
              >
                ×
              </button>
            </div>
          ) : null}

          {interactionAvailable ? renderInput(attachmentMenu) : null}
        </>
      )}
    </AttachmentMenu>
  );
  function renderInput(attachmentMenu: ReactNode) {
    return (
      <div
        hidden={!composerExpanded}
        className={`interaction-composer${dragging ? " interaction-composer-dragging" : ""}`}
        onDragOver={(event) => {
          if (!event.dataTransfer.types.includes("Files")) return;
          event.preventDefault();
          const blocked = isUploading() || interactionBlocked;
          event.dataTransfer.dropEffect = blocked ? "none" : "copy";
          setDragging(!blocked);
        }}
        onDragLeave={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false);
        }}
        onDrop={(event) => {
          if (
            !event.dataTransfer.files.length &&
            !Array.from(event.dataTransfer.items ?? []).some((item) => item.kind === "file")
          )
            return;
          event.preventDefault();
          setDragging(false);
          const items = Array.from(event.dataTransfer.items ?? []);
          if (items.some((item) => item.webkitGetAsEntry?.()?.isDirectory)) {
            if (!isUploading()) setUploadError(new LocalizedError("foldersAreNotSupported"));
            return;
          }
          void uploadFiles(Array.from(event.dataTransfer.files));
        }}
      >
        {dragging ? <p role="status">{t("dropFilesToUpload")}</p> : null}
        <AttachmentList
          attachments={attachments}
          disabled={actionsDisabled || !!uploadProgress}
          onRemove={(id) => {
            if (!interactionSending) removeAttachment(id);
          }}
        />
        <textarea
          ref={composer}
          onPaste={(event) => {
            const files = Array.from(event.clipboardData.files);
            if (!files.length) return;
            event.preventDefault();
            void uploadFiles(files);
          }}
          aria-label={t("messageToAgent")}
          value={message}
          rows={3}
          maxLength={MAX_INTERACTION_MESSAGE_BYTES}
          placeholder={t(enterToSend ? "shiftNewline" : "shiftSend")}
          onChange={(event) => setMessage(event.target.value)}
          onKeyDown={onKeyDown}
        />
        {messageTooLarge ? (
          <p className="interaction-message-limit" role="alert">
            {t("messageLimit", {
              size: formatNumber(messageBytes),
              limit: formatNumber(MAX_INTERACTION_MESSAGE_BYTES),
            })}
          </p>
        ) : null}
        <div className="interaction-actions">
          <div className="interaction-secondary-actions">
            <button
              type="button"
              className="interaction-handoff"
              title={t("handOffThisPaneSBindingToTheActiveCodexSession")}
              aria-disabled={inputActionsDisabled}
              onClick={() => void handoff().catch(() => undefined)}
            >
              {t("handoff")}
            </button>
            <button
              type="button"
              className="interaction-interrupt"
              aria-disabled={inputActionsDisabled}
              onClick={interrupt}
            >
              {t("interrupt")}
            </button>
          </div>
          <div className="interaction-primary-actions">
            {attachmentMenu}
            <button
              type="button"
              className="interaction-send"
              aria-disabled={inputActionsDisabled || messageIsBlank || messageTooLarge}
              onClick={() => void send().catch(() => undefined)}
            >
              {t("send")}
            </button>
          </div>
        </div>
      </div>
    );
  }
}

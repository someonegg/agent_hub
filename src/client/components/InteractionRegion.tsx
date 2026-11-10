import type { ReactNode } from "react";
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";

import type {
  InteractionKey,
  InteractionResponse,
  TerminalPreviewSnapshot,
} from "../../shared/api-contract";

import { t } from "../i18n";
import { useSessionComposerPreference } from "../state/composer-preferences";
import { useSessionDraft } from "../state/session-drafts";
import { InteractionComposer } from "./InteractionComposer";
import { InternalLink } from "./InternalLink";
import { TerminalPreview } from "./TerminalPreview";

interface InteractionRegionProps {
  sessionId: string;
  messagesReady?: boolean;
  hasMoreMessages?: boolean;
  dockTarget?: HTMLElement | null;
  recoveryActions?: ReactNode;
  operationStatus?: ReactNode;

  interaction: InteractionResponse | null;
  onNavigate?: (sessionId: string) => void;
  interactionBusy: boolean;
  error: string | null;
  errorDetail?: unknown;
  onDismissError: () => void;
  onHandoffPaneBinding: () => Promise<void>;
  onExpandPreview: () => void;
  onSendMessage: (message: string) => Promise<void>;
  onSendKeys: (keys: readonly InteractionKey[]) => Promise<void>;
  onSendTerminalKeys?: (keys: readonly InteractionKey[]) => Promise<void>;
  preview: TerminalPreviewSnapshot | null;
  previewBusy: boolean;
  previewStopped: boolean;
  onRetryPreview: () => void;
  previewError: string | null;
  previewErrorDetail?: unknown;
  previewExpanded: boolean;
  onTogglePreview: () => void;
}

export function InteractionRegion({
  sessionId,
  messagesReady = true,
  hasMoreMessages = false,
  dockTarget,
  recoveryActions,
  operationStatus,
  interaction,
  onNavigate,
  interactionBusy,
  error,
  errorDetail,
  onDismissError,
  onSendMessage,
  onHandoffPaneBinding,
  onExpandPreview,
  onSendKeys,
  onSendTerminalKeys = onSendKeys,
  preview,
  previewBusy,
  previewStopped,
  onRetryPreview,
  previewError,
  previewErrorDetail,
  previewExpanded,
  onTogglePreview,
}: InteractionRegionProps) {
  useTranslation();
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const interactionAvailable = interaction?.supported === true && interaction.state === "connected";
  const flow = useRef<HTMLDivElement | null>(null);
  const preference = useSessionComposerPreference(sessionId);
  const { message, attachments } = useSessionDraft(sessionId);
  const hasDraft = message.length > 0 || attachments.length > 0;
  const [composerExpanded, setComposerExpanded] = useState<boolean | null>(null);
  const [composerFocusRequest, setComposerFocusRequest] = useState(0);
  const inputExpanded = composerExpanded ?? true;
  const previousPreference = useRef(preference.expanded);
  useLayoutEffect(() => {
    if (previousPreference.current === preference.expanded) return;
    previousPreference.current = preference.expanded;
    if (preference.expanded !== undefined) setComposerExpanded(preference.expanded);
  }, [preference.expanded]);
  useLayoutEffect(() => {
    if (composerExpanded !== null || !messagesReady || !interactionAvailable) return;
    const scroll = flow.current?.closest<HTMLElement>(".message-scroll");
    const timeline = scroll?.querySelector<HTMLElement>(".timeline");
    const longConversation =
      hasMoreMessages ||
      (!!scroll && !!timeline && timeline.getBoundingClientRect().height > scroll.clientHeight);
    setComposerExpanded(hasDraft || (preference.expanded ?? !longConversation));
  }, [
    composerExpanded,
    messagesReady,
    interactionAvailable,
    hasMoreMessages,
    hasDraft,
    preference.expanded,
  ]);
  const scrollToEnd = () => {
    const scroll = flow.current?.closest<HTMLElement>(".message-scroll");
    scroll?.scrollTo({ top: scroll.scrollHeight, behavior: "instant" });
  };
  const wasPreviewExpanded = useRef(false);
  const hadPreviewContent = useRef(false);
  const previewContentId = useId();
  const previewToggle = useRef<HTMLButtonElement | null>(null);
  const previewHasContent = (preview?.content.length ?? 0) > 0;
  useLayoutEffect(() => {
    const expanded = previewExpanded && interactionAvailable;
    const firstContent = expanded && previewHasContent && !hadPreviewContent.current;
    if (expanded && (!wasPreviewExpanded.current || firstContent)) {
      requestAnimationFrame(() => {
        if (mounted.current) scrollToEnd();
      });
    }
    wasPreviewExpanded.current = expanded;
    hadPreviewContent.current = expanded && (hadPreviewContent.current || previewHasContent);
  }, [previewExpanded, interactionAvailable, previewHasContent]);
  const status = interactionStatus(interaction?.supported ? interaction.state : "unavailable");
  const statusLabel = (
    <span className={`interaction-status interaction-status-${status.kind}`}>{status.label}</span>
  );
  const connectionStatus =
    interaction?.supported && interaction.state === "unbound" ? (
      <div className="interaction-connection-status">
        {statusLabel}
        <span className="resume-reason">{t("ensureTheOriginalSessionHasExited")}</span>
      </div>
    ) : (
      statusLabel
    );
  return (
    <>
      <div ref={flow} className="interaction-flow">
        {interactionAvailable ? (
          <TerminalPreview
            preview={preview}
            previewBusy={previewBusy}
            previewStopped={previewStopped}
            previewError={previewError}
            previewErrorDetail={previewErrorDetail}
            previewExpanded={previewExpanded}
            contentId={previewContentId}
            busy={interactionBusy}
            onSendKeys={onSendTerminalKeys}
            onRetry={onRetryPreview}
            onToggle={() => {
              onTogglePreview();
              previewToggle.current?.focus({ preventScroll: true });
            }}
          />
        ) : null}
      </div>
      {dockTarget ? createPortal(renderDock(), dockTarget) : renderDock()}
    </>
  );

  function renderDock() {
    return (
      <section className="interaction-region" aria-label={t("sessionInteraction")}>
        {interactionAvailable ? (
          <div className="interaction-toolbar">
            <button
              type="button"
              className="composer-toggle"
              aria-expanded={inputExpanded}
              onClick={() => {
                const expanded = !inputExpanded;
                setComposerExpanded(expanded);
                preference.setExpanded(expanded);
                if (expanded) setComposerFocusRequest((value) => value + 1);
              }}
            >
              <svg
                className="composer-toggle-icon"
                width="8"
                height="8"
                viewBox="0 0 8 8"
                fill="currentColor"
                aria-hidden="true"
              >
                <path d={inputExpanded ? "M0 2h8L4 6z" : "M2 0v8l4-4z"} />
              </svg>
              <span>{t("inputArea")}</span>
            </button>
            {interaction?.supported &&
            (interaction.activity === "working" || interaction.activity === "idle") ? (
              <span
                className={`terminal-activity terminal-activity-${interaction.activity}`}
                role="status"
              >
                <span className="terminal-activity-dot" aria-hidden="true" />
                {interaction.activity === "working" ? t("working") : t("idle")}
              </span>
            ) : null}
            <button
              type="button"
              ref={previewToggle}
              className="terminal-preview-toggle"
              aria-expanded={previewExpanded}
              aria-pressed={previewExpanded}
              aria-label={t("terminalPreview")}
              aria-controls={previewContentId}
              onClick={onTogglePreview}
            >
              <svg
                className="preview-icon"
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.75"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <rect x="3" y="4" width="18" height="16" rx="3" />
                <path d="m7 9 3 3-3 3M13 15h4" />
              </svg>
              <span>{t("terminalPreview")}</span>
            </button>
          </div>
        ) : null}

        {status.kind !== "connected" || recoveryActions ? (
          <div className="interaction-heading">
            {status.kind !== "connected" ? connectionStatus : null}
            {interaction?.supported && interaction.state === "superseded" ? (
              interaction.supersededBySessionId ? (
                <InternalLink
                  href={`/sessions/${encodeURIComponent(interaction.supersededBySessionId)}`}
                  onNavigate={
                    onNavigate ? () => onNavigate(interaction.supersededBySessionId!) : undefined
                  }
                >
                  {t("goToBoundSession")}
                </InternalLink>
              ) : (
                <span>{t("replacementSessionUnavailable")}</span>
              )
            ) : null}
            <div className="interaction-management-actions">{recoveryActions}</div>
          </div>
        ) : null}
        <div className="interaction-region-content">
          {operationStatus}
          <InteractionComposer
            sessionId={sessionId}
            interactionAvailable={interactionAvailable}
            interactionBusy={interactionBusy}
            composerExpanded={inputExpanded}
            composerFocusRequest={composerFocusRequest}
            previewExpanded={previewExpanded}
            error={error}
            errorDetail={errorDetail}
            onDismissError={onDismissError}
            onSendMessage={onSendMessage}
            onSendKeys={onSendKeys}
            onHandoffPaneBinding={onHandoffPaneBinding}
            onExpandPreview={onExpandPreview}
            scrollToEnd={scrollToEnd}
          />
        </div>
      </section>
    );
  }
}

function interactionStatus(
  state: "unbound" | "disconnected" | "connected" | "unknown" | "unavailable" | "superseded",
): { kind: "warning" | "connected"; label: string } {
  if (state === "superseded") return { kind: "warning", label: t("superseded") };
  if (state === "disconnected") return { kind: "warning", label: t("disconnected") };
  if (state === "unbound") return { kind: "warning", label: t("unbound") };
  if (state === "unknown") return { kind: "warning", label: t("connectionUnknown") };
  if (state === "unavailable") return { kind: "warning", label: t("unavailable") };
  return { kind: "connected", label: t("connected") };
}

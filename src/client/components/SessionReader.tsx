import { type ReactNode, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import type { SessionMessagesResponse } from "../../shared/api-contract";

import { t } from "../i18n";
import { EmptyState } from "./EmptyState";
import { ErrorState } from "./ErrorState";
import { EventMark } from "./EventMark";
import { MessageItem } from "./MessageItem";
import { PageJumpControls } from "./PageJumpControls";
import { isNearScrollEnd } from "./scroll-position";
import { SessionHeader } from "./SessionHeader";
import { SessionInteraction } from "./SessionInteraction";
import { Timeline } from "./Timeline";

interface SessionReaderProps {
  agentNickname?: string;
  recoveryActions?: ReactNode;
  operationStatus?: ReactNode;
  managementBusy?: boolean;
  management?: ReactNode;
  onNavigate?: (sessionId: string) => void;
  context: SessionMessagesResponse;
  readerLoading: boolean;
  readerBusy: boolean;
  onLoadMore: () => void;
  error?: string | null;
  retrying?: boolean;
}

export function SessionReader({
  agentNickname,
  recoveryActions,
  operationStatus,
  managementBusy,
  management,
  onNavigate,
  context,
  readerLoading,
  readerBusy,
  onLoadMore,
  error,
  retrying,
}: SessionReaderProps) {
  useTranslation();
  const [dockTarget, setDockTarget] = useState<HTMLElement | null>(null);
  const reader = useRef<HTMLDivElement | null>(null);
  const [messageScroll, setMessageScroll] = useState<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!messageScroll) return;
    let follow = isNearScrollEnd(messageScroll);
    let height = messageScroll.scrollHeight;
    let viewportHeight = messageScroll.clientHeight;
    const onScroll = () => {
      const nearEnd = isNearScrollEnd(messageScroll);
      if (height === messageScroll.scrollHeight || nearEnd) follow = nearEnd;
    };
    const observer =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(() => {
            const next = messageScroll.scrollHeight;
            if (
              follow &&
              !context.hasMore &&
              (next > height || viewportHeight !== messageScroll.clientHeight)
            )
              messageScroll.scrollTo({ top: next, behavior: "instant" });
            height = next;
            viewportHeight = messageScroll.clientHeight;
          });
    if (reader.current) observer?.observe(reader.current);
    observer?.observe(messageScroll);
    messageScroll.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      observer?.disconnect();
      messageScroll.removeEventListener("scroll", onScroll);
    };
  }, [messageScroll, context.session.id, context.hasMore]);
  useEffect(() => {
    const viewport = window.visualViewport;
    const host =
      reader.current?.closest<HTMLElement>(".hub") ??
      reader.current?.closest<HTMLElement>(".session-layout");
    if (!viewport || !host) return;
    // iOS can pan the visual viewport after resizing it to reveal the focused input.
    // Keep the session shell aligned with that viewport; its children stay in normal layout.
    const update = () => {
      host.style.setProperty("--session-viewport-height", `${viewport.height}px`);
      host.style.setProperty("--session-viewport-top", `${Math.max(0, viewport.offsetTop)}px`);
    };
    update();
    viewport.addEventListener("resize", update);
    viewport.addEventListener("scroll", update);
    return () => {
      viewport.removeEventListener("resize", update);
      viewport.removeEventListener("scroll", update);
      host.style.removeProperty("--session-viewport-height");
      host.style.removeProperty("--session-viewport-top");
    };
  }, []);
  const { hasMore, items, interaction } = context;
  const [preview, setPreview] = useState<{
    sessionId: string;
    items: typeof items;
    message: string;
  } | null>(null);
  // The reader preserves the items array when a poll contains no displayable messages.
  const messagePreview =
    preview?.sessionId === context.session.id && preview.items === items ? preview : null;
  if (preview && !messagePreview) setPreview(null);
  const showMessagePreview = (message: string) => {
    const next = { sessionId: context.session.id, items, message };
    setPreview(next);
    return () => setPreview((current) => (current === next ? null : current));
  };
  const latestMessage = items.at(-1) ?? null;
  const previewAutoExpandKey =
    !hasMore &&
    latestMessage &&
    (latestMessage.kind === "user_input" ||
      (latestMessage.kind === "message" &&
        latestMessage.role === "assistant" &&
        latestMessage.phase === "response" &&
        latestMessage.itemType === "plan"))
      ? latestMessage.id
      : null;
  return (
    <section className="session-layout" aria-labelledby="session-title">
      <div className="message-region">
        <div ref={setMessageScroll} className="message-scroll" tabIndex={0}>
          <div ref={reader} className="reader">
            <SessionHeader
              agentNickname={agentNickname}
              management={management}
              session={context.session}
            />
            {items.length === 0 && !readerLoading && !messagePreview ? (
              <EmptyState title={t("thisSessionHasNoMessages")}>
                {t("waitForTheSessionToUpdate")}
              </EmptyState>
            ) : null}
            {items.length > 0 || hasMore ? (
              <Timeline
                items={items}
                sessionId={context.session.id}
                hasMore={hasMore}
                loading={readerLoading}
                readerBusy={readerBusy}
                onLoadMore={onLoadMore}
              />
            ) : null}
            {messagePreview ? (
              <ol
                className="timeline message-preview"
                aria-label={t("messagePreview")}
                aria-live="polite"
              >
                <li className="trace-event human">
                  <EventMark item={{ kind: "message" }} />
                  <MessageItem
                    preview
                    item={{
                      kind: "message",
                      id: "preview",
                      ordinal: 0,
                      timestamp: null,
                      role: "user",
                      phase: null,
                      itemType: null,
                      markdown: messagePreview.message,
                    }}
                  />
                </li>
              </ol>
            ) : null}
            {context.session.status !== "archived" && dockTarget ? (
              <SessionInteraction
                key={context.session.id}
                dockTarget={dockTarget}
                recoveryActions={recoveryActions}
                operationStatus={operationStatus}
                managementBusy={managementBusy}
                interaction={interaction}
                onNavigate={onNavigate}
                sessionId={context.session.id}
                messagesReady={!readerLoading}
                hasMoreMessages={hasMore}
                onMessagePreview={showMessagePreview}
                previewAutoExpandKey={previewAutoExpandKey}
              />
            ) : null}
            {error ? (
              <ErrorState
                title={t("couldNotLoadSession")}
                message={error}
                retryNotice={retrying ? t("automaticallyRetrying") : undefined}
              />
            ) : null}
          </div>
        </div>
        <PageJumpControls scrollElement={messageScroll} contentElement={reader.current} />
      </div>
      <div ref={setDockTarget} className="interaction-dock" />
    </section>
  );
}

import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import type { SessionAgent } from "../shared/api-contract";

import { ErrorState } from "./components/ErrorState";
import { ManageSession, OperationStatus, ResumeSession } from "./components/HubManagement";
import { InternalLink } from "./components/InternalLink";
import { SessionReader } from "./components/SessionReader";
import { t } from "./i18n";
import { useHubOperation } from "./state/use-hub-operation";
import { useSessionReader } from "./state/use-session-reader";

interface SessionPageProps {
  agents?: readonly SessionAgent[];
  sessionId: string;
  onNavigate?: (id: string | null) => void;
  onCatalogChanged?: () => void;
  onUpdatedAt?: (id: string, updatedAt: string | null) => void;
}

export function SessionPage({
  sessionId,
  agents = [],
  onNavigate,
  onCatalogChanged,
  onUpdatedAt,
}: SessionPageProps) {
  useTranslation();
  const focused = useRef(false);
  const reader = useSessionReader(sessionId);
  const [managementOperation, setManagementOperation] = useState(false);
  const operation = useHubOperation(sessionId, (op) => {
    onCatalogChanged?.();
    if (op.type === "delete") onNavigate?.(null);
    else void reader.refreshLatest();
  });
  const showManagementStatus = operation.operation
    ? operation.operation.type === "archive" || operation.operation.type === "delete"
    : managementOperation;
  const sessionTitle = reader.context === null ? null : reader.context.session.title;

  const displayedId = reader.context?.session.id;
  const updatedAt = reader.context?.session.updatedAt;
  useEffect(() => {
    if (displayedId !== undefined && updatedAt !== undefined) onUpdatedAt?.(displayedId, updatedAt);
  }, [displayedId, updatedAt, onUpdatedAt]);

  useEffect(() => {
    document.title = sessionTitle === null ? "Agent Hub" : `${sessionTitle} · Agent Hub`;
  }, [sessionTitle]);

  useEffect(() => {
    if (sessionTitle !== null && !focused.current) {
      focused.current = true;
      document.getElementById("session-title")?.focus({ preventScroll: true });
    }
  }, [sessionTitle]);

  return (
    <div className="reader-page">
      {reader.context ? (
        <SessionReader
          agentNickname={agents.length > 1 ? reader.context.session.origin.agent : undefined}
          managementBusy={operation.busy}
          operationStatus={
            !showManagementStatus ? <OperationStatus controller={operation} compact /> : null
          }
          recoveryActions={
            !(
              reader.context.interaction?.supported &&
              reader.context.interaction.state === "connected"
            ) ? (
              <ResumeSession
                key={sessionId}
                session={reader.context.session}
                controller={operation}
                onStart={() => setManagementOperation(false)}
              />
            ) : null
          }
          management={
            <ManageSession
              management={
                agents.find((agent) => agent.nickname === reader.context!.session.origin.agent)
                  ?.management
              }
              key={sessionId}
              interaction={reader.context.interaction}
              controller={operation}
              showStatus={showManagementStatus}
              onStart={() => setManagementOperation(true)}
              session={reader.context.session}
              onDeleted={() => {
                onCatalogChanged?.();
                onNavigate?.(null);
              }}
              onChanged={() => {
                void reader.refreshLatest();
                onCatalogChanged?.();
              }}
            />
          }
          context={reader.context}
          onNavigate={onNavigate}
          readerLoading={reader.readerLoading}
          readerBusy={reader.operation !== null}
          onLoadMore={reader.loadMore}
          error={reader.readerError}
          retrying={reader.readerRetrying}
        />
      ) : reader.readerError ? (
        <section className="reader">
          <ErrorState
            title={reader.missing ? t("sessionNotFound") : t("couldNotLoadSession")}
            message={reader.readerError}
            onRetry={reader.missing ? undefined : () => void reader.refreshLatest()}
            retryLabel={t("retryOpeningSession")}
          />
          {reader.missing ? (
            <InternalLink href="/" onNavigate={onNavigate ? () => onNavigate(null) : undefined}>
              {t("backToHome")}
            </InternalLink>
          ) : null}
        </section>
      ) : (
        <section className="reader reader-welcome">
          <p className="loading" role="status">
            {t("openingSession")}
          </p>
        </section>
      )}
    </div>
  );
}

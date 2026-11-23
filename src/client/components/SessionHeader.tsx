import { type ReactNode, useState } from "react";
import { useTranslation } from "react-i18next";

import type { SessionDetail } from "../../shared/domain";

import { formatDate, t } from "../i18n";
import { AttachCommand } from "./AttachCommand";
import { StatusBadge } from "./StatusBadge";
import { UploadHistoryLink } from "./UploadHistoryLink";

interface SessionHeaderProps {
  agentNickname?: string;
  attachCommand?: string | null;
  management?: ReactNode;
  session: SessionDetail;
}

export function SessionHeader({
  agentNickname,
  attachCommand,
  management,
  session,
}: SessionHeaderProps) {
  useTranslation();
  const [openSessionId, setOpenSessionId] = useState<string | null>(null);
  const updatedAt = formatTimestamp(session.updatedAt);

  return (
    <header className="reader-header">
      <div>
        <div className="session-title-row">
          <h2 id="session-title" tabIndex={-1}>
            {session.title}
          </h2>
          {management}
        </div>
        <div className="session-metadata">
          <StatusBadge status={session.status} />
          <span>{session.origin.runtimeName}</span>
          {agentNickname !== undefined ? (
            <>
              <span>·</span>
              <span>
                {t("agentLabel")} {agentNickname}
              </span>
            </>
          ) : null}
          <span>·</span>
          <span>{updatedAt}</span>
        </div>
        <div className="reader-controls">
          <details
            className="session-information"
            key={session.id}
            onToggle={(event) => setOpenSessionId(event.currentTarget.open ? session.id : null)}
          >
            <summary>{t("sessionInformation")}</summary>
            <div className="session-information-content">
              {session.taskName ? (
                <p className="session-meta">
                  {t("task")} <span>{session.taskName}</span>
                </p>
              ) : null}
              <p className="session-meta">
                {t("projectDirectory")} <code>{session.projectDirectory ?? t("unavailable")}</code>
              </p>
              <p className="session-meta">
                {t("workingDirectory")} <code>{session.workingDirectory ?? t("unavailable")}</code>
              </p>
              <p className="session-origin">{sessionOriginLabel(session.origin)}</p>
              <p className="session-source-id">
                {t("originalSessionID")} <code>{session.sourceId}</code>
              </p>
              {attachCommand && openSessionId === session.id ? (
                <AttachCommand key={attachCommand} command={attachCommand} />
              ) : null}
              <p>
                <UploadHistoryLink sessionId={session.id} className="session-uploads-link" />
              </p>
            </div>
          </details>
        </div>
      </div>
    </header>
  );
}

function formatTimestamp(value: string | null): string {
  if (value === null) return t("timeUnavailable");
  const date = new Date(value);
  return Number.isNaN(date.valueOf())
    ? t("timeUnavailable")
    : formatDate(date, {
        dateStyle: "medium",
        timeStyle: "short",
      });
}

function sessionOriginLabel(origin: SessionDetail["origin"]): string {
  let label = origin.runtimeName;
  if (origin.runtimeVersion !== null) label += ` ${origin.runtimeVersion}`;
  return label;
}

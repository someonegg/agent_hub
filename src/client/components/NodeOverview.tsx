import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import type { SessionSummary } from "../../shared/domain";

import { listNodes, nodeCatalog } from "../api/client";
import { t } from "../i18n";
import { currentNode, navigateNode, nodePagePath } from "../node-path";
import { InternalLink } from "./InternalLink";
import { RequestError } from "./RequestError";
import { Settings } from "./Settings";
import { StatusBadge } from "./StatusBadge";

export function NodeOverview() {
  useTranslation();
  const [nodes, setNodes] = useState<{ id: string }[]>();
  const [error, setError] = useState<unknown>();
  useEffect(() => {
    document.title = "Agent Hub";
    const controller = new AbortController();
    const { signal } = controller;
    void listNodes(signal).then(
      ({ nodes }) => {
        if (!signal.aborted) setNodes(nodes);
      },
      (reason: unknown) => {
        if (!signal.aborted) setError(reason);
      },
    );
    return () => controller.abort();
  }, []);
  return (
    <main className="node-overview">
      <header className="artifacts-heading">
        <h1>{t("nodes")}</h1>
        <Settings />
      </header>
      {error ? (
        <p role="alert">
          <RequestError error={error} />
        </p>
      ) : null}
      {!nodes && !error ? <p role="status">{t("loadingSessions")}</p> : null}
      <div className="node-grid">
        {nodes?.map(({ id }) => (
          <NodeCard key={id} id={id} />
        ))}
      </div>
    </main>
  );
}

function NodeCard({ id }: { id: string }) {
  const [attempt, setAttempt] = useState(0);
  const [recent, setRecent] = useState<SessionSummary[] | "offline">();
  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;
    void nodeCatalog(id, signal).then(
      ({ sessions }) => {
        if (signal.aborted) return;
        const timestamp = (session: SessionSummary) =>
          session.updatedAt ? Date.parse(session.updatedAt) || 0 : 0;
        setRecent(sessions.sort((a, b) => timestamp(b) - timestamp(a)).slice(0, 5));
      },
      () => {
        if (!signal.aborted) setRecent("offline");
      },
    );
    return () => controller.abort();
  }, [id, attempt]);
  let content;
  if (recent === "offline") {
    content = (
      <div>
        <p role="status">{t("nodeUnavailable")}</p>
        <button
          type="button"
          onClick={() => {
            setRecent(undefined);
            setAttempt(attempt + 1);
          }}
        >
          {t("retry")}
        </button>
      </div>
    );
  } else if (recent === undefined) {
    content = <p role="status">{t("loadingSessions")}</p>;
  } else if (recent.length === 0) {
    content = <p>{t("nodeNoSessions")}</p>;
  } else {
    content = (
      <ul>
        {recent.map((session) => (
          <li key={session.id}>
            <NodeLink path={nodePagePath(`/sessions/${encodeURIComponent(session.id)}`, id)}>
              {session.taskName || session.title}
            </NodeLink>
            <StatusBadge status={session.status} />
          </li>
        ))}
      </ul>
    );
  }
  return (
    <section className="node-card">
      <h2>
        <NodeLink path={nodePagePath("/", id)}>{id}</NodeLink>
      </h2>
      {content}
    </section>
  );
}

function NodeLink({ path, children }: { path: string; children: string }) {
  return (
    <InternalLink href={path} onNavigate={() => navigateNode(path)}>
      {children}
    </InternalLink>
  );
}

export function NodeOverviewLink() {
  useTranslation();
  const node = currentNode();
  if (!node) return null;
  const label = `${t("nodes")} / ${node}`;
  return (
    <InternalLink
      className="hub-node-link"
      title={label}
      href="/"
      onNavigate={() => navigateNode("/")}
    >
      {label}
    </InternalLink>
  );
}

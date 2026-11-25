import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { api } from "../api/client";
import { formatDate, t } from "../i18n";
import { nodePagePath } from "../node-path";
import { catalogGroups } from "../state/catalog-groups";
import type { useHubNavigation } from "../state/use-hub-navigation";
import type { useSessionList } from "../state/use-session-list";
import { ErrorState } from "./ErrorState";
import { InternalLink } from "./InternalLink";
import { Settings } from "./Settings";
import { SidebarToggle } from "./SidebarToggle";
import { StatusBadge } from "./StatusBadge";
interface HubSidebarProps {
  catalog: ReturnType<typeof useSessionList>;
  hub: ReturnType<typeof useHubNavigation>;
  agentFilter?: string;
  onAgentFilter?: (value: string) => void;
  onCollapse?: () => void;
  onCreate: (directory: string | null) => void;
}
export function HubSidebar({
  catalog,
  hub,
  onCreate,
  onCollapse,
  agentFilter = "",
  onAgentFilter,
}: HubSidebarProps) {
  const { i18n } = useTranslation();
  const language = i18n.resolvedLanguage;
  const [hosting, setHosting] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    void api
      .capabilities(controller.signal)
      .then((data) => {
        if (!controller.signal.aborted) setHosting(data.hosting === true);
      })
      .catch(() => {});
    return () => controller.abort();
  }, []);
  const {
    sessionId,
    navigation,
    setIncludeArchived,
    toggleProject,
    persistScroll,
    sidebar,
    projectNav,
    navigate,
  } = hub;
  const groups = useMemo(
    () => catalogGroups(catalog.list, navigation.includeArchived),
    [catalog.list, navigation.includeArchived],
  );
  const updatedAtLabels = useMemo(
    () =>
      new Map(
        (catalog.list?.sessions ?? []).map((item) => [
          item.id,
          shortActivity(item.updatedAt, language),
        ]),
      ),
    [catalog.list, language],
  );
  return (
    <aside id="hub-sidebar" ref={sidebar} className="hub-sidebar" aria-label={t("sessionList")}>
      <div className="catalog-filters">
        {(catalog.list?.agents?.length ?? 0) > 1 ? (
          <label className="agent-filter">
            {t("agent")}
            <select
              aria-label={t("filterByAgent")}
              value={agentFilter}
              onChange={(event) => onAgentFilter?.(event.target.value)}
            >
              <option value="">{t("allAgents")}</option>
              {catalog.list!.agents.map((agent) => (
                <option key={agent.nickname} value={agent.nickname}>
                  {agent.nickname} · {agent.runtimeName}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        {onCollapse ? <SidebarToggle collapsed={false} onToggle={onCollapse} /> : null}
      </div>
      <div className="hub-section-label">
        <span>{t("projects")}</span>
        <div className="hub-section-actions">
          <button
            type="button"
            className="archive-toggle"
            aria-label={t("showArchivedSessions")}
            aria-pressed={navigation.includeArchived}
            title={t("showArchivedSessions")}
            onClick={() => setIncludeArchived(!navigation.includeArchived)}
          >
            <svg
              width="15"
              height="15"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.35"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <rect x="1.75" y="2.5" width="12.5" height="3" rx="0.75" />
              <path d="M2.75 5.5v7.25a1 1 0 0 0 1 1h8.5a1 1 0 0 0 1-1V5.5" />
              <path d="M6.25 8.75h3.5" />
            </svg>
          </button>
          <button
            type="button"
            aria-label={t("newSession")}
            onClick={() => {
              onCreate(null);
            }}
          >
            ＋
          </button>
        </div>
      </div>
      <nav
        ref={projectNav}
        aria-label={t("projectsAndSessions")}
        onScroll={(event) => persistScroll(event.currentTarget)}
      >
        {catalog.listLoading ? <p role="status">{t("loadingSessions")}</p> : null}
        {catalog.list && groups.length === 0 ? (
          <p className="hub-empty">{t("noSessionsYet")}</p>
        ) : null}
        {groups.map((group) => {
          const groupName = group.directory === null ? t("unknownProject") : group.name;
          const key = group.directory ?? "unknown";
          const expanded = navigation.expanded.includes(key);
          return (
            <section className="hub-project" key={key} data-project={key}>
              <div className="project-heading">
                <button
                  type="button"
                  title={group.directory ?? groupName}
                  aria-label={t("projectSessions", {
                    project: groupName,
                    count: group.sessions.length,
                  })}
                  aria-expanded={expanded}
                  onClick={() => toggleProject(key)}
                >
                  <span aria-hidden="true">{expanded ? "⌄" : "›"}</span>
                  <span className="project-name">{groupName}</span>
                  <small> {group.sessions.length}</small>
                </button>
                {group.directory ? (
                  <button
                    type="button"
                    aria-label={t("newProjectSession", { project: groupName })}
                    onClick={() => {
                      onCreate(group.directory);
                    }}
                  >
                    ＋
                  </button>
                ) : null}
              </div>
              {expanded ? (
                <ul>
                  {group.sessions.map((session) => {
                    const updatedAtLabel = updatedAtLabels.get(session.id);
                    return (
                      <li key={session.id}>
                        <InternalLink
                          href={nodePagePath(`/sessions/${session.id}`)}
                          aria-current={sessionId === session.id ? "page" : undefined}
                          title={session.title}
                          onNavigate={() => navigate(session.id)}
                        >
                          <span className="session-nav-copy">
                            <span>{session.title}</span>
                            {(catalog.list?.agents?.length ?? 0) > 1 ? (
                              <small className="session-nav-agent">{session.agent}</small>
                            ) : null}
                            {updatedAtLabel ? (
                              <time dateTime={session.updatedAt!}>{updatedAtLabel}</time>
                            ) : null}
                          </span>
                          <StatusBadge status={session.status} />
                        </InternalLink>
                      </li>
                    );
                  })}
                </ul>
              ) : null}
            </section>
          );
        })}
        {catalog.listError ? (
          <ErrorState
            title={t("couldNotUpdateSessionList")}
            message={catalog.listError}
            retryNotice={catalog.listRetrying ? t("automaticallyRetrying") : undefined}
          />
        ) : null}
      </nav>
      <footer className="hub-sidebar-footer">
        <Settings agents={catalog.list?.agents ?? []} />
        {hosting ? (
          <a href={nodePagePath("/artifacts")} target="_blank" rel="noopener noreferrer">
            {t("publishedPages")}
          </a>
        ) : null}
      </footer>
    </aside>
  );
}

function shortActivity(value: string | null | undefined, language?: string): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.valueOf())
    ? null
    : formatDate(
        date,
        {
          month: "short",
          day: "numeric",
          hour: "2-digit",
          minute: "2-digit",
        },
        language,
      );
}

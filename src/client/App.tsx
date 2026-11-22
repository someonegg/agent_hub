import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";

import { ArtifactsPage } from "./components/ArtifactsPage";
import { DiffPage } from "./components/DiffPage";
import { CreateSession } from "./components/HubManagement";
import { HubSidebar } from "./components/HubSidebar";
import { NodeTabs } from "./components/NodeTabs";
import { SidebarToggle } from "./components/SidebarToggle";
import { UploadsPage } from "./components/UploadsPage";
import { t } from "./i18n";
import { currentNode, localPagePath, subscribeNode } from "./node-path";
import { SessionPage } from "./SessionPage";
import { browserStorage } from "./state/browser-storage";
import { SessionCache, SessionMessageCache } from "./state/session-cache";
import { SessionDraftProvider } from "./state/session-drafts";
import { useHubNavigation } from "./state/use-hub-navigation";
import { useSessionList } from "./state/use-session-list";
export function App({ multi = false }: { multi?: boolean } = {}) {
  const url = useSyncExternalStore(subscribeNode, () => location.href);
  const node = currentNode();
  const [messageCache] = useState(() => new SessionMessageCache());
  const caches = useRef(new Map<string | undefined, SessionCache>());
  const recentPaths = useRef(new Map<string, string>());
  useEffect(() => {
    if (!multi) return;
    const remember = () => {
      const active = currentNode();
      const path = localPagePath();
      if (active && (path === "/" || path.startsWith("/sessions/"))) {
        const { pathname, search, hash } = window.location;
        recentPaths.current.set(active, pathname + search + hash);
      }
    };
    remember();
    return subscribeNode(remember);
  }, [multi]);
  const path = localPagePath();
  if (path.startsWith("/diffs/")) return <DiffPage />;
  if (path === "/artifacts") return <ArtifactsPage />;
  let cache = caches.current.get(node);
  if (!cache) {
    cache = new SessionCache(messageCache, node);
    caches.current.set(node, cache);
  }
  return (
    <SessionDraftProvider>
      <div className="hub-with-header">
        {multi ? (
          <NodeTabs node={node} activeUrl={url} recentPaths={recentPaths.current} />
        ) : (
          <header className="hub-header">
            <span className="hub-brand-icon">
              <img className="brand-logo" src="/favicon.svg" alt="" width="24" height="24" />
            </span>
            <span className="hub-brand-label">Agent Hub</span>
          </header>
        )}
        {!multi || node ? <SessionHub key={node} cache={cache} /> : null}
      </div>
    </SessionDraftProvider>
  );
}

function SessionHub({ cache }: { cache: SessionCache }) {
  useTranslation();
  const catalog = useSessionList(cache);
  const [agentFilter, setAgentFilter] = useState(() => browserStorage.getItem("ahub.agent") ?? "");
  const agents = catalog.list?.agents ?? [];
  const selectedAgent = agents.some((agent) => agent.nickname === agentFilter) ? agentFilter : "";
  useEffect(() => {
    if (!catalog.list) return;
    if (agentFilter !== selectedAgent) setAgentFilter("");
    browserStorage.setItem("ahub.agent", selectedAgent);
  }, [catalog.list, agentFilter, selectedAgent]);
  const visibleList = useMemo(
    () =>
      !selectedAgent || !catalog.list
        ? catalog.list
        : {
            ...catalog.list,
            sessions: catalog.list.sessions.filter((session) => session.agent === selectedAgent),
          },
    [catalog.list, selectedAgent],
  );
  const visibleCatalog = { ...catalog, list: visibleList };
  const hub = useHubNavigation(catalog.list);
  const { sessionId, navigate, selectedProject } = hub;
  const [sidebarCollapsed, setSidebarCollapsed] = useState(
    () => browserStorage.getItem("ahub.sidebar-collapsed") === "true",
  );
  const [createDirectory, setCreateDirectory] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  function toggleSidebar() {
    const collapsed = !sidebarCollapsed;
    setSidebarCollapsed(collapsed);
    browserStorage.setItem("ahub.sidebar-collapsed", String(collapsed));
    requestAnimationFrame(() => {
      document
        .querySelector<HTMLButtonElement>(
          collapsed ? ".hub-topbar .hub-sidebar-toggle" : ".hub-sidebar .hub-sidebar-toggle",
        )
        ?.focus({ preventScroll: true });
    });
  }
  return (
    <main
      className={`hub${sessionId ? " has-session" : ""}${sidebarCollapsed ? " sidebar-collapsed" : ""}`}
    >
      <HubSidebar
        onCollapse={toggleSidebar}
        catalog={visibleCatalog}
        agentFilter={selectedAgent}
        onAgentFilter={setAgentFilter}
        hub={hub}
        onCreate={(directory) => {
          setCreateDirectory(directory);
          setCreateOpen(true);
        }}
      />
      <div className="hub-content">
        <div className="hub-topbar">
          {sidebarCollapsed ? <SidebarToggle collapsed onToggle={toggleSidebar} /> : null}
          {sessionId ? (
            <>
              <button
                className="hub-back"
                type="button"
                aria-label={t("backToList")}
                onClick={() => navigate(null)}
              >
                <svg
                  aria-hidden="true"
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M21 12H3m7-7-7 7 7 7" />
                </svg>
              </button>
              <span>{t("projects")}</span>
              <span aria-hidden="true">/</span>
              <strong>
                {catalog.list?.projects
                  .find((project) => project.directory === selectedProject)
                  ?.directory.split(/[\\/]/)
                  .filter(Boolean)
                  .at(-1) ?? t("unknownProject")}
              </strong>
              <span aria-hidden="true">/</span>
              <span>{t("session")}</span>
            </>
          ) : null}
        </div>
        {sessionId ? (
          <>
            {hub.uploadsOpen ? (
              <UploadsPage
                key={sessionId}
                sessionId={sessionId}
                onBack={() => navigate(sessionId)}
              />
            ) : (
              <SessionPage
                cache={cache}
                key={sessionId}
                sessionId={sessionId}
                agents={agents}
                onNavigate={navigate}
                onCatalogChanged={catalog.refresh}
                onUpdatedAt={catalog.reportUpdatedAt}
              />
            )}
          </>
        ) : (
          <section className="hub-welcome">
            <p className="eyebrow">{t("projectHub")}</p>
            <h1>{t("selectASessionFromTheSidebar")}</h1>
            <p>{t("browseSessionsByProjectReadTheirHistoryAndContinueYourWork")}</p>
            <button
              type="button"
              onClick={() => {
                setCreateDirectory(null);
                setCreateOpen(true);
              }}
            >
              {t("newSession")}
            </button>
          </section>
        )}
      </div>
      {createOpen ? (
        <CreateSession
          agents={agents}
          selectedAgent={selectedAgent}
          project={createDirectory ?? ""}
          projects={(catalog.list?.projects ?? []).map((item) => ({ project: item.directory }))}
          onClose={() => setCreateOpen(false)}
          onCreated={(operation) => {
            setCreateOpen(false);
            catalog.refresh();
            if (operation.sessionId) navigate(operation.sessionId);
          }}
        />
      ) : null}
    </main>
  );
}

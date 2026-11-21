import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";

import { ArtifactsPage } from "./components/ArtifactsPage";
import { DiffPage } from "./components/DiffPage";
import { CreateSession } from "./components/HubManagement";
import { HubSidebar } from "./components/HubSidebar";
import { NodeOverview, NodeOverviewLink } from "./components/NodeOverview";
import { SidebarToggle } from "./components/SidebarToggle";
import { UploadsPage } from "./components/UploadsPage";
import { t } from "./i18n";
import { currentNode, localPagePath, subscribeNode } from "./node-path";
import { SessionPage } from "./SessionPage";
import { browserStorage } from "./state/browser-storage";
import { SessionDraftProvider } from "./state/session-drafts";
import { useHubNavigation } from "./state/use-hub-navigation";
import { useSessionList } from "./state/use-session-list";
export function App({ multi = false }: { multi?: boolean } = {}) {
  const node = useSyncExternalStore(subscribeNode, currentNode);
  const path = localPagePath();
  if (path.startsWith("/diffs/")) return <DiffPage />;
  if (path === "/artifacts") return <ArtifactsPage />;
  return (
    <SessionDraftProvider>
      {multi && !node ? <NodeOverview /> : <SessionHub key={node} />}
    </SessionDraftProvider>
  );
}

function SessionHub() {
  useTranslation();
  const catalog = useSessionList();
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
          collapsed ? ".hub-topbar .hub-sidebar-toggle" : ".hub-brand .hub-sidebar-toggle",
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
          {sessionId || sidebarCollapsed ? <NodeOverviewLink /> : null}
          {sidebarCollapsed ? <SidebarToggle collapsed onToggle={toggleSidebar} /> : null}
          {sessionId ? (
            <>
              <button className="hub-back" type="button" onClick={() => navigate(null)}>
                {t("backToList")}
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

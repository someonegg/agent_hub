import "../styles/artifacts.css";

import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import type { ArtifactsResponse, ArtifactSummary } from "../../shared/api-contract";

import { api } from "../api/client";
import { copyText } from "../copy-text";
import { formatDate, t } from "../i18n";
import { nodePagePath } from "../node-path";
import { RequestError } from "./RequestError";

export function ArtifactsPage() {
  const { i18n } = useTranslation();
  useEffect(() => {
    document.title = `${t("pages")} · Agent Hub`;
  }, [i18n.resolvedLanguage]);
  const [projects, setProjects] = useState<ArtifactsResponse["projects"]>([]);
  const [error, setError] = useState<unknown>("");
  const [copyFeedback, setCopyFeedback] = useState<"linkCopied" | "couldNotCopyLink" | null>(null);
  const [busy, setBusy] = useState(true);
  async function copyLink(url: string) {
    setCopyFeedback(
      (await copyText(location.origin + nodePagePath(url))) ? "linkCopied" : "couldNotCopyLink",
    );
  }
  const loadProjects = useCallback(async () => {
    const data = await api.artifacts();
    setProjects(data.projects);
  }, []);
  const runOperation = useCallback(async (action: () => Promise<void>) => {
    setBusy(true);
    setCopyFeedback(null);
    setError("");
    try {
      await action();
    } catch (error) {
      setError(error);
    } finally {
      setBusy(false);
    }
  }, []);
  function refresh() {
    return runOperation(loadProjects);
  }
  async function deleteArtifact(artifact: ArtifactSummary) {
    if (!confirm(t("deleteArtifact", { title: artifact.title }))) return;
    await runOperation(async () => {
      await api.deleteArtifact(artifact.id);
      await loadProjects();
    });
  }
  useEffect(() => {
    void runOperation(loadProjects);
  }, [loadProjects, runOperation]);
  return (
    <section className="artifacts-page">
      <header className="artifacts-heading">
        <div>
          <p className="eyebrow">{t("publishedSnapshots")}</p>
          <h1>{t("pages")}</h1>
        </div>
        <button type="button" disabled={busy} onClick={() => void refresh()}>
          {t("refresh")}
        </button>
      </header>
      {!!error ? (
        <p role="alert">
          <RequestError error={error} />
        </p>
      ) : null}
      {copyFeedback ? (
        <p role={copyFeedback === "linkCopied" ? "status" : "alert"}>{t(copyFeedback)}</p>
      ) : null}
      {busy ? <p role="status">{t("loadingPages")}</p> : null}
      {!busy && !error && projects.length === 0 ? <p>{t("noPublishedWebPages")}</p> : null}
      {projects.map((project) => (
        <section key={project.directory}>
          <h2>{project.directory}</h2>
          {project.artifacts.map((artifact) => (
            <article key={artifact.id}>
              <h3>{artifact.title}</h3>
              <time dateTime={artifact.updatedAt}>
                {formatDate(new Date(artifact.updatedAt), {
                  dateStyle: "short",
                  timeStyle: "medium",
                })}
              </time>
              <div className="artifact-actions">
                <a href={nodePagePath(artifact.url)} target="_blank" rel="noreferrer">
                  {t("open")}
                </a>
                <button type="button" onClick={() => void copyLink(artifact.url)}>
                  {t("copyLink")}
                </button>
                <button type="button" disabled={busy} onClick={() => void deleteArtifact(artifact)}>
                  {t("delete")}
                </button>
              </div>
            </article>
          ))}
        </section>
      ))}
    </section>
  );
}

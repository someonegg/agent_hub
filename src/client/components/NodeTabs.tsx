import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { listNodes } from "../api/client";
import { t } from "../i18n";
import { currentNode, navigateNode, nodePagePath } from "../node-path";
import { InternalLink } from "./InternalLink";
import { RequestError } from "./RequestError";

export function NodeTabs({
  node,
  activeUrl,
  recentPaths,
}: {
  node: string | undefined;
  activeUrl: string;
  recentPaths: ReadonlyMap<string, string>;
}) {
  useTranslation();
  const [nodes, setNodes] = useState<{ id: string }[]>([]);
  const [error, setError] = useState<unknown>();
  const [attempt, setAttempt] = useState(0);

  const stripRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const labelsRef = useRef<HTMLDivElement>(null);
  const [overflow, setOverflow] = useState(false);
  const [edges, setEdges] = useState({ left: true, right: true });

  function updateEdges() {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const left = viewport.scrollLeft <= 1;
    const right = viewport.scrollWidth - viewport.clientWidth - viewport.scrollLeft <= 1;
    setEdges((previous) =>
      previous.left === left && previous.right === right ? previous : { left, right },
    );
  }

  function scrollTabs(direction: -1 | 1) {
    const viewport = viewportRef.current;
    const labels = labelsRef.current;
    if (!viewport || !labels) return;
    const visible = viewport.getBoundingClientRect();
    const forward = direction === 1;
    const edge = forward ? visible.right : visible.left;
    const clipped = Array.from(labels.children, (label) => label.getBoundingClientRect()).find(
      (tab) => tab.left < edge && edge < tab.right && tab.width < visible.width,
    );
    if (!clipped) {
      viewport.scrollBy({ left: direction * viewport.clientWidth });
      return;
    }
    viewport.scrollBy({
      left: forward ? clipped.left - visible.left : clipped.right - visible.right,
    });
  }

  useLayoutEffect(() => {
    const strip = stripRef.current;
    const viewport = viewportRef.current;
    const labels = labelsRef.current;
    if (!strip || !viewport || !labels) return;

    const updateLayout = () => {
      setOverflow(labels.getBoundingClientRect().width > strip.getBoundingClientRect().width);
      const active = labels.querySelector('[aria-current="page"]');
      if (active) {
        const tab = active.getBoundingClientRect();
        const visible = viewport.getBoundingClientRect();
        if (tab.left < visible.left) viewport.scrollLeft += tab.left - visible.left;
        else if (tab.right > visible.right && tab.width <= visible.width)
          viewport.scrollLeft += tab.right - visible.right;
        else if (tab.left >= visible.right) viewport.scrollLeft += tab.left - visible.left;
      }
      updateEdges();
    };

    updateLayout();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(updateLayout);
    observer.observe(strip);
    observer.observe(labels);
    return () => observer.disconnect();
  }, [node, nodes, overflow]);

  useEffect(() => {
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
  }, [attempt]);

  useEffect(() => {
    if (!node && nodes[0]) navigateNode(nodePagePath("/", nodes[0].id), "replace");
  }, [node, nodes]);

  return (
    <nav className="hub-header hub-node-tabs" aria-label={t("nodes")}>
      <span className="hub-brand-icon">
        <img className="brand-logo" src="/favicon.svg" alt="" width="24" height="24" />
      </span>
      <div className="hub-node-strip" ref={stripRef}>
        {overflow && (
          <button
            type="button"
            aria-label={t("scrollNodesLeft")}
            disabled={edges.left}
            onClick={() => scrollTabs(-1)}
          >
            <span aria-hidden="true">‹</span>
          </button>
        )}
        <div className="hub-node-viewport" ref={viewportRef} onScroll={updateEdges}>
          <div className="hub-node-labels" ref={labelsRef}>
            {nodes.map(({ id }) => {
              const active = id === node;
              const href = active ? activeUrl : (recentPaths.get(id) ?? nodePagePath("/", id));
              return (
                <InternalLink
                  key={id}
                  href={href}
                  aria-current={active ? "page" : undefined}
                  onNavigate={() => {
                    if (currentNode() !== id) navigateNode(href);
                  }}
                >
                  {id}
                </InternalLink>
              );
            })}
          </div>
        </div>
        {overflow && (
          <button
            type="button"
            aria-label={t("scrollNodesRight")}
            disabled={edges.right}
            onClick={() => scrollTabs(1)}
          >
            <span aria-hidden="true">›</span>
          </button>
        )}
      </div>
      {error ? (
        <>
          <span role="alert">
            <RequestError error={error} />
          </span>
          <button
            type="button"
            onClick={() => {
              setError(undefined);
              setAttempt(attempt + 1);
            }}
          >
            {t("retry")}
          </button>
        </>
      ) : nodes.length === 0 ? (
        <span role="status">{t("loadingSessions")}</span>
      ) : null}
    </nav>
  );
}

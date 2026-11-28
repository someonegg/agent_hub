import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";

import type { HubOperation, InteractionResponse, SessionAgent } from "../../shared/api-contract";
import type { SessionDetail } from "../../shared/domain";
import type { PermissionMode } from "../../shared/permission-mode";

import { api } from "../api/client";
import { t } from "../i18n";
import { currentNode, nodePagePath } from "../node-path";
import { browserStorage } from "../state/browser-storage";
import { usePreferences } from "../state/preferences";
import { useHubOperation } from "../state/use-hub-operation";
import { AttachCommand } from "./AttachCommand";
import { PermissionModeSelect } from "./PermissionModeSelect";
import { ProjectDirectory } from "./ProjectDirectory";
import { RequestError } from "./RequestError";

const OPERATION_LABELS = {
  create: "operationCreate",
  archive: "operationArchive",
  delete: "operationDelete",
  exit: "operationExit",
} as const;
const STATUS_LABELS = {
  pending: "statusPending",
  succeeded: "statusSucceeded",
  failed: "statusFailed",
  unknown: "statusUnknown",
} as const;
const PHASE_LABELS = {
  sending_exit: "sendingExitCommand",
  waiting_exit: "waitingForExit",
  archiving: "archiving",
  confirming_archive: "confirmingArchive",
  deleting: "deletingHistory",
  confirming_delete: "confirmingDelete",
} as const;

// getRandomValues is available over HTTP as well as in secure contexts.
function newRequestId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export type OperationController = ReturnType<typeof useHubOperation>;
export function OperationStatus({
  controller,
  compact = false,
}: {
  controller: OperationController;
  compact?: boolean;
}) {
  useTranslation();
  const op = controller.operation;
  const [dismissed, setDismissed] = useState<HubOperation | null>(null);
  useEffect(() => {
    if (op?.status !== "succeeded") return;
    const timer = setTimeout(() => setDismissed(op), 2_000);
    return () => clearTimeout(timer);
  }, [op]);
  return (
    <>
      {op && op !== dismissed ? (
        <aside className="operation-status" role="status">
          <strong>
            {t(op.mode === "resume" ? "operationResume" : OPERATION_LABELS[op.type])} ·{" "}
            {t(STATUS_LABELS[op.status])}
          </strong>
          {compact && op.status === "pending" && op.phase ? (
            <p>{t(PHASE_LABELS[op.phase])}</p>
          ) : null}
          {compact ? (
            <details>
              <summary>{t("requestDetails")}</summary>
              {renderDetails()}
            </details>
          ) : (
            renderDetails()
          )}
        </aside>
      ) : null}
      {controller.error ? (
        <div role="alert">
          <p>
            <RequestError error={controller.error} />
          </p>
          {controller.canCheck ? (
            <button type="button" onClick={controller.check}>
              {t("retryStatusCheck")}
            </button>
          ) : controller.errorPhase === "submit" ? (
            <p>{t("useTheOriginalActionButtonToTryAgain")}</p>
          ) : null}
        </div>
      ) : null}
    </>
  );
  function renderDetails() {
    if (!op) return null;
    return (
      <>
        {op.status === "pending" && op.type === "create" ? (
          <p>
            {op.attachCommand
              ? t("noAgentSessionDetectedYetAttachToTmuxToCheckStartupProgress")
              : t("startingAgent")}
          </p>
        ) : null}
        {!compact && op.status === "pending" && op.phase ? (
          <p>{t(PHASE_LABELS[op.phase])}</p>
        ) : null}
        {op.attachCommand ? <AttachCommand command={op.attachCommand} /> : null}
        {op.status === "unknown" ? (
          <p>
            {t("trackingHasStoppedRefreshTheSessionListToCheckTheResult")}{" "}
            {op.type === "create"
              ? t("attachToTmuxBeforeTryingAgainCreatingAgainMayStartAnotherSession")
              : t("checkTheCurrentStateBeforeTryingAgain")}
          </p>
        ) : null}
        {op.error ? (
          <p>
            <RequestError error={op.error} />
          </p>
        ) : null}
        <small>
          {t("operation")} {op.operationId}
        </small>
      </>
    );
  }
}
interface CreateSessionProps {
  agents?: readonly SessionAgent[];
  selectedAgent?: string;
  project: string;
  projects: readonly { project: string }[];
  onCreated: (op: HubOperation) => void;
  onClose: () => void;
}

export function CreateSession({
  agents = [],
  selectedAgent = "",
  project,
  projects,
  onCreated,
  onClose,
}: CreateSessionProps) {
  useTranslation();
  const preferences = usePreferences();
  const dialog = useRef<HTMLDialogElement>(null);
  const node = currentNode();
  const projectKey = "ahub.create-project";
  const launchDirectory = project || (node && browserStorage.getItem(projectKey)) || "";
  const [directory, setDirectory] = useState(launchDirectory);
  const initialAgent =
    selectedAgent ||
    agents.find((agent) => agent.nickname === preferences.defaultAgent)?.nickname ||
    agents[0]?.nickname ||
    "";
  const [agent, setAgent] = useState(initialAgent);
  useEffect(() => {
    dialog.current?.showModal?.();
    dialog.current?.querySelector<HTMLElement>("h2")?.focus({ preventScroll: true });
  }, []);
  const [worktree, setWorktree] = useState(preferences.worktree);
  const [permissionMode, setPermissionMode] = useState(preferences.permissionMode);
  const request = useRef<{ fingerprint: string; id: string } | null>(null);
  const controller = useHubOperation(
    "create",
    (operation) => {
      dialog.current?.close();
      onCreated(operation);
    },
    {
      lifetime: "mount",
      onTerminal: () => {
        request.current = null;
      },
    },
  );
  function close() {
    dialog.current?.close();
    onClose();
  }
  return (
    <dialog
      ref={dialog}
      className="create-session"
      aria-label={t("newSession")}
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
    >
      <button
        type="button"
        className="dialog-close"
        aria-label={t("closeNewSession")}
        onClick={close}
      >
        ×
      </button>
      <h2 tabIndex={-1}>{t("newSession")}</h2>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          const fingerprint = JSON.stringify([agent, directory, worktree, permissionMode]);
          void controller.start(async () => {
            if (request.current?.fingerprint !== fingerprint) {
              request.current = { fingerprint, id: newRequestId() };
            }
            return api.createSession({
              ...(agent ? { agent } : {}),
              projectDirectory: directory,
              worktree,
              permissionMode,
              requestId: request.current.id,
            });
          });
        }}
      >
        {agents.length > 1 ? (
          <label>
            {t("agent")}
            <select
              required
              aria-label={t("sessionAgent")}
              value={agent}
              disabled={controller.busy}
              onChange={(event) => setAgent(event.target.value)}
            >
              <option value="" disabled>
                {t("selectAnAgent")}
              </option>
              {agents.map((agent) => (
                <option key={agent.nickname} value={agent.nickname}>
                  {agent.nickname} · {agent.runtimeName}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <ProjectDirectory
          value={directory}
          projects={projects}
          disabled={controller.busy}
          onChange={(directory) => {
            setDirectory(directory);
            if (node) browserStorage.setItem(projectKey, directory, node);
          }}
        />
        <PermissionModeSelect
          value={permissionMode}
          onChange={setPermissionMode}
          disabled={controller.busy}
        />
        <label className="check-row">
          <input
            type="checkbox"
            checked={worktree}
            onChange={(event) => setWorktree(event.target.checked)}
            disabled={controller.busy}
          />
          {t("enableWorktree")}
        </label>
        <OperationStatus controller={controller} />
        <button
          type="submit"
          disabled={
            controller.busy ||
            !directory.startsWith("/") ||
            (agents.length > 1 && !agents.some((item) => item.nickname === agent))
          }
        >
          {controller.busy ? t("creating") : t("createSession")}
        </button>
      </form>
    </dialog>
  );
}
interface ManageSessionProps {
  management?: SessionAgent["management"];
  interaction?: InteractionResponse | null;
  session: SessionDetail;
  triggerTarget?: HTMLElement | null;
  statusTarget?: HTMLElement | null;
  onChanged: () => void;
  onDeleted?: () => void;
  controller?: OperationController;
  showStatus?: boolean;
  onStart?: () => void;
  onHandoffBusyChange?: (busy: boolean) => void;
}

export function ManageSession(props: ManageSessionProps) {
  return props.controller ? (
    <ManageSessionControls
      management={props.management}
      session={props.session}
      triggerTarget={props.triggerTarget}
      statusTarget={props.statusTarget}
      interaction={props.interaction}
      controller={props.controller}
      onStart={props.onStart}
      onHandoffBusyChange={props.onHandoffBusyChange}
      showStatus={
        props.showStatus ??
        (props.controller.operation?.type === "archive" ||
          props.controller.operation?.type === "delete")
      }
    />
  ) : (
    <StandaloneManageSession {...props} />
  );
}

function StandaloneManageSession({
  management,
  session,
  triggerTarget,
  statusTarget,
  interaction,
  onChanged,
  onDeleted,
  onHandoffBusyChange,
}: ManageSessionProps) {
  const controller = useHubOperation(session.id, (operation) => {
    if (operation.type === "delete") {
      if (onDeleted) onDeleted();
      else window.location.assign(nodePagePath("/"));
    } else onChanged();
  });
  return (
    <ManageSessionControls
      management={management}
      session={session}
      triggerTarget={triggerTarget}
      statusTarget={statusTarget}
      interaction={interaction}
      controller={controller}
      onHandoffBusyChange={onHandoffBusyChange}
      showStatus
    />
  );
}

function ManageSessionControls({
  management,
  interaction,
  session,
  triggerTarget,
  statusTarget,
  controller,
  showStatus,
  onStart,
  onHandoffBusyChange,
}: {
  session: SessionDetail;
  management?: SessionAgent["management"];
  interaction?: InteractionResponse | null;
  triggerTarget?: HTMLElement | null;
  statusTarget?: HTMLElement | null;
  controller: OperationController;
  showStatus: boolean;
  onStart?: () => void;
  onHandoffBusyChange?: (busy: boolean) => void;
}) {
  useTranslation();
  const [menuOpen, setMenuOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [handoffBusy, setHandoffBusy] = useState(false);
  const [handoffError, setHandoffError] = useState<unknown>(null);
  const handoffInFlight = useRef(false);
  const handoffBusyReported = useRef(false);
  const handoffGeneration = useRef(0);
  const activeSessionId = useRef(session.id);
  const onHandoffBusyChangeRef = useRef(onHandoffBusyChange);
  onHandoffBusyChangeRef.current = onHandoffBusyChange;
  const mounted = useRef(true);
  const reportHandoffBusy = (nextBusy: boolean) => {
    if (handoffBusyReported.current === nextBusy) return;
    handoffBusyReported.current = nextBusy;
    onHandoffBusyChangeRef.current?.(nextBusy);
  };
  const invalidateHandoff = () => {
    handoffGeneration.current += 1;
    handoffInFlight.current = false;
  };
  if (activeSessionId.current !== session.id) {
    activeSessionId.current = session.id;
    invalidateHandoff();
  }
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      invalidateHandoff();
      reportHandoffBusy(false);
    };
  }, []);
  useEffect(() => {
    setHandoffBusy(false);
    setHandoffError(null);
    return () => {
      invalidateHandoff();
      reportHandoffBusy(false);
    };
  }, [session.id]);
  const busy = controller.busy || handoffBusy;
  const runHandoff = async () => {
    if (busy || handoffInFlight.current) return;
    handoffInFlight.current = true;
    const generation = ++handoffGeneration.current;
    setHandoffBusy(true);
    setHandoffError(null);
    reportHandoffBusy(true);
    try {
      await api.handoffPaneBinding(session.id);
    } catch (reason) {
      if (mounted.current && handoffGeneration.current === generation) setHandoffError(reason);
    } finally {
      if (handoffGeneration.current === generation) {
        handoffInFlight.current = false;
        if (mounted.current) {
          setHandoffBusy(false);
          reportHandoffBusy(false);
        }
      }
    }
  };
  const deleteDialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (deleteOpen) deleteDialog.current?.showModal();
    else deleteDialog.current?.close();
  }, [deleteOpen]);
  const menu = useRef<HTMLDivElement>(null);
  const actionMenu = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const closeMenu = () => {
    setMenuOpen(false);
    menu.current?.querySelector<HTMLButtonElement>(".session-menu-trigger")?.focus();
  };
  const startOperation = (request: () => Promise<HubOperation>) => {
    setHandoffError(null);
    onStart?.();
    void controller.start(request);
  };
  useLayoutEffect(() => {
    if (!menuOpen) return;
    const position = () => {
      const host = menu.current;
      const popup = actionMenu.current;
      if (!host || !popup) return;
      popup.style.left = "";
      popup.style.right = "";
      const margin = 8;
      const rect = popup.getBoundingClientRect();
      if (rect.width <= 0) return;
      const hostRect = host.getBoundingClientRect();
      if (rect.right > window.innerWidth - margin) {
        if (hostRect.right - rect.width >= margin) {
          popup.style.left = "auto";
          popup.style.right = "0px";
        } else {
          popup.style.left = `${Math.max(margin, window.innerWidth - margin - rect.width) - hostRect.left}px`;
          popup.style.right = "auto";
        }
      } else if (rect.left < margin) {
        popup.style.left = `${margin - hostRect.left}px`;
        popup.style.right = "auto";
      }
    };
    position();
    window.addEventListener("resize", position);
    return () => window.removeEventListener("resize", position);
  }, [menuOpen]);
  useEffect(() => {
    if (!menuOpen) return;
    menu.current?.querySelector<HTMLButtonElement>(".session-action-menu button")?.focus();
    const close = (event: PointerEvent) => {
      if (!menu.current?.contains(event.target as Node)) setMenuOpen(false);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [menuOpen]);
  const menuControls = (
    <div
      className="session-menu-host"
      ref={menu}
      onKeyDown={(event) => {
        if (event.key === "Escape") closeMenu();
      }}
    >
      <button
        type="button"
        className="session-menu-trigger"
        aria-label={t("sessionManagement")}
        aria-expanded={menuOpen}
        aria-controls={menuOpen ? menuId : undefined}
        onClick={() => setMenuOpen(!menuOpen)}
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
          <circle cx="3.25" cy="8" r="1.25" />
          <circle cx="8" cy="8" r="1.25" />
          <circle cx="12.75" cy="8" r="1.25" />
        </svg>
      </button>
      {menuOpen ? (
        <div className="session-action-menu" id={menuId} ref={actionMenu}>
          {management?.archive !== false && session.status !== "archived" ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                closeMenu();
                startOperation(() => api.archiveSession(session.id));
              }}
            >
              {t("archiveSession")}
            </button>
          ) : null}
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              closeMenu();
              setDeleteOpen(true);
            }}
          >
            {t("deleteSession")}
          </button>
          {interaction?.supported && interaction.state === "connected" ? (
            <>
              <button
                type="button"
                title={t("handOffThisPaneSBindingToTheActiveAgentSession")}
                disabled={busy}
                onClick={() => {
                  closeMenu();
                  void runHandoff();
                }}
              >
                {t("handoff")}
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  closeMenu();
                  startOperation(() => api.exitSession(session.id));
                }}
              >
                {t("exitSession")}
              </button>
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  );
  const operationDetails =
    showStatus || handoffError ? (
      <div className="session-operation-details">
        {showStatus ? <OperationStatus controller={controller} /> : null}
        {handoffError ? (
          <div className="interaction-error" role="alert">
            <span>
              <RequestError error={handoffError} />
            </span>
            <button
              type="button"
              onClick={() => setHandoffError(null)}
              aria-label={t("dismissInteractionError")}
            >
              ×
            </button>
          </div>
        ) : null}
      </div>
    ) : null;
  return (
    <>
      {triggerTarget ? createPortal(menuControls, triggerTarget) : null}
      {statusTarget && operationDetails ? createPortal(operationDetails, statusTarget) : null}
      <div
        className={
          triggerTarget ? "session-management session-management-detached" : "session-management"
        }
      >
        {triggerTarget ? null : menuControls}
        <dialog
          ref={deleteDialog}
          className="create-session"
          aria-label={t("deleteSession")}
          onCancel={() => setDeleteOpen(false)}
          onClose={() => setDeleteOpen(false)}
        >
          <h2>{t("deleteSessionLabel")}</h2>
          <p>{t("deleteSessionConfirmation")}</p>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (busy) return;
              setDeleteOpen(false);
              startOperation(() => api.deleteSession(session.id));
            }}
          >
            <button type="button" autoFocus onClick={() => setDeleteOpen(false)}>
              {t("cancel")}
            </button>
            <button type="submit" disabled={busy}>
              {t("confirmDelete")}
            </button>
          </form>
        </dialog>
        {statusTarget ? null : operationDetails}
      </div>
    </>
  );
}

export function ResumeSession({
  session,
  controller,
  onStart,
}: {
  session: SessionDetail;
  controller: OperationController;
  onStart?: () => void;
}) {
  useTranslation();
  const preferences = usePreferences();
  const [open, setOpen] = useState(false);
  const [permissionMode, setPermissionMode] = useState<PermissionMode>("default");
  const request = useRef<{ permissionMode: PermissionMode; id: string } | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (open) {
      dialog.current?.showModal?.();
      dialog.current?.querySelector<HTMLElement>("h2")?.focus({ preventScroll: true });
    } else dialog.current?.close?.();
  }, [open]);
  useEffect(() => {
    if (controller.operation && controller.operation.status !== "pending") request.current = null;
    if (controller.operation?.status === "succeeded") setOpen(false);
  }, [controller.operation]);
  return (
    <>
      {session.resume.allowed ? (
        <button
          type="button"
          className="interaction-management-trigger"
          disabled={controller.busy}
          onClick={() => {
            setPermissionMode(preferences.permissionMode);
            setOpen(true);
          }}
        >
          {t("resume")}
        </button>
      ) : (
        <span className="resume-reason">
          <RequestError error={session.resume.reason} summary="resumeUnavailable" />
        </span>
      )}
      <dialog
        ref={dialog}
        className="create-session"
        aria-label={t("resumeSession")}
        onCancel={() => setOpen(false)}
      >
        <button
          type="button"
          className="dialog-close"
          aria-label={t("closeResumeSession")}
          onClick={() => setOpen(false)}
        >
          ×
        </button>
        <h2 tabIndex={-1}>{t("resumeSession")}</h2>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (!request.current || request.current.permissionMode !== permissionMode)
              request.current = { permissionMode, id: newRequestId() };
            onStart?.();
            void controller.start(() =>
              api.createSession({
                resumeSessionId: session.id,
                permissionMode,
                requestId: request.current!.id,
              }),
            );
            setOpen(false);
          }}
        >
          <PermissionModeSelect
            value={permissionMode}
            onChange={setPermissionMode}
            disabled={controller.busy}
          />
          <button type="submit" disabled={controller.busy || !session.resume.allowed}>
            {t("resumeSession")}
          </button>
        </form>
      </dialog>
    </>
  );
}

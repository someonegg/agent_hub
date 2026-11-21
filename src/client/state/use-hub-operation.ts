import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

import type { HubOperation } from "../../shared/api-contract";

import { api, ApiClientError } from "../api/client";
import { nodeStorageKey } from "../node-path";
import { setSessionComposerExpanded } from "./composer-preferences";
import { createRequestChannel } from "./request-channel";
import { messageFor } from "./request-errors";
import {
  INITIAL_RETRY_MS,
  isRetryableRequestError,
  nextRetryMs,
  retryDelayMs,
} from "./retry-policy";

type CommonState = { error: string | null; errorPhase: "submit" | "query" | null };
type State = CommonState &
  (
    | { lifecycle: "idle" | "submitting"; operation: null }
    | { lifecycle: "recovering"; operation: null; operationId: string }
    | { lifecycle: "tracking"; operation: HubOperation }
    | { lifecycle: "stopped"; operation: HubOperation | null; operationId: string }
    | { lifecycle: "terminal"; operation: HubOperation }
  );
const initial = {
  lifecycle: "idle",
  operation: null,
  error: null,
  errorPhase: null,
} satisfies State;
type Action =
  | { type: "reset"; id: string | null }
  | { type: "submit" }
  | { type: "receive"; operation: HubOperation }
  | {
      type: "failure";
      phase: "submit" | "query";
      error: string;
      missing?: boolean;
      retryable?: boolean;
    };
function reducer(state: State, action: Action): State {
  switch (action.type) {
    case "reset":
      return action.id ? { ...initial, lifecycle: "recovering", operationId: action.id } : initial;
    case "submit":
      return { ...initial, lifecycle: "submitting" };
    case "receive":
      return action.operation.status === "pending"
        ? { ...initial, lifecycle: "tracking", operation: action.operation }
        : { ...initial, lifecycle: "terminal", operation: action.operation };
    case "failure": {
      if (action.phase === "submit" || action.missing)
        return { ...initial, error: action.error, errorPhase: action.phase };
      const id = operationId(state);
      if (!id) return state;
      const failure = { error: action.error, errorPhase: "query" as const };
      if (!action.retryable)
        return { ...failure, lifecycle: "stopped", operation: state.operation, operationId: id };
      return state.operation
        ? { ...failure, lifecycle: "tracking", operation: state.operation }
        : { ...failure, lifecycle: "recovering", operation: null, operationId: id };
    }
  }
}

function operationId(state: State): string | null {
  if (state.lifecycle === "tracking") return state.operation.operationId;
  return "operationId" in state ? state.operationId : null;
}

interface OperationRun {
  disposed: boolean;
  querying: boolean;
  reported: boolean;
  retry: number;
  timer?: ReturnType<typeof setTimeout>;
  channel: ReturnType<typeof createRequestChannel>;
}

function disposeRun(run: OperationRun) {
  run.disposed = true;
  run.channel.cancel();
  clearTimeout(run.timer);
}

const submissions = new Map<string, Promise<HubOperation>>();

export function useHubOperation(
  scope: string,
  onSuccess: (operation: HubOperation) => void,
  {
    lifetime,
    onTerminal,
  }: { lifetime?: "mount"; onTerminal?: (operation: HubOperation) => void } = {},
) {
  const storageKey = `ahub.operation.${scope}`;
  const key = nodeStorageKey(storageKey);
  const recoverable = lifetime !== "mount";
  const [state, setState] = useState<State>(initial);
  const current = useRef<State>(initial);
  const runtime = useRef<OperationRun | null>(null);
  const success = useRef(onSuccess);
  success.current = onSuccess;
  const terminal = useRef(onTerminal);
  terminal.current = onTerminal;
  const query = useRef<() => Promise<void>>(async () => {});
  const isActive = useCallback(
    (run: OperationRun) =>
      runtime.current === run && !run.disposed && nodeStorageKey(storageKey) === key,
    [key, storageKey],
  );
  useLayoutEffect(() => {
    if (recoverable) return;
    return () => {
      const run = runtime.current;
      if (run) disposeRun(run);
    };
  }, [key, recoverable]);
  const commit = useCallback(
    (run: OperationRun, action: Action) => {
      if (!isActive(run)) return;
      current.current = reducer(current.current, action);
      setState(current.current);
    },
    [isActive],
  );
  const removeMarker = useCallback(() => {
    if (!recoverable) return;
    try {
      sessionStorage.removeItem(key);
    } catch {
      /* Optional storage. */
    }
  }, [key, recoverable]);
  const receive = useCallback(
    (run: OperationRun, next: HubOperation) => {
      if (next.status !== "pending") {
        removeMarker();
        terminal.current?.(next);
      }
      commit(run, { type: "receive", operation: next });
      if (next.status === "succeeded" && !run.reported) {
        run.reported = true;
        if (next.mode === "resume" && next.sessionId)
          setSessionComposerExpanded(next.sessionId, true);
        success.current(next);
      }
    },
    [commit, removeMarker],
  );
  const schedule = (run: OperationRun, delay: number) => {
    clearTimeout(run.timer);
    if (isActive(run) && operationId(current.current) && document.visibilityState !== "hidden")
      run.timer = setTimeout(() => void query.current(), delay);
  };
  query.current = async () => {
    const run = runtime.current;
    if (
      !run ||
      !isActive(run) ||
      run.querying ||
      document.visibilityState === "hidden" ||
      !operationId(current.current)
    )
      return;
    clearTimeout(run.timer);
    run.querying = true;
    const request = run.channel.begin();
    let delay: number | null = null;
    try {
      const next = await api.operation(operationId(current.current)!, request.signal);
      if (!request.isCurrent() || !isActive(run)) return;
      receive(run, next);
      run.retry = INITIAL_RETRY_MS;
      if (next.status === "pending") delay = 1000;
    } catch (reason) {
      if (!request.isCurrent() || !isActive(run)) return;
      const missing = reason instanceof ApiClientError && reason.status === 404;
      const retryable = isRetryableRequestError(reason);
      if (missing) removeMarker();
      commit(run, {
        type: "failure",
        phase: "query",
        error: messageFor(reason),
        missing,
        retryable,
      });
      if (!missing && retryable) {
        delay = retryDelayMs(run.retry);
        run.retry = nextRetryMs(run.retry);
      }
    } finally {
      if (request.isCurrent()) run.querying = false;
      if (request.isCurrent() && delay !== null) schedule(run, delay);
    }
  };
  const watchSubmission = useRef<
    (run: OperationRun, submission: Promise<HubOperation>) => Promise<void>
  >(async () => {});
  watchSubmission.current = async (run, submission) => {
    run.reported = false;
    commit(run, { type: "submit" });
    try {
      const next = await submission;
      if (!isActive(run)) return;
      receive(run, next);
      if (next.status === "pending") schedule(run, 1000);
    } catch (reason) {
      commit(run, { type: "failure", phase: "submit", error: messageFor(reason) });
    }
  };
  useEffect(() => {
    let id: string | null = null;
    try {
      if (recoverable) id = sessionStorage.getItem(key);
    } catch {
      /* Optional storage. */
    }
    const run: OperationRun = {
      disposed: false,
      querying: false,
      reported: false,
      retry: INITIAL_RETRY_MS,
      channel: createRequestChannel(),
    };
    runtime.current = run;
    commit(run, { type: "reset", id });
    const visibility = () => {
      clearTimeout(run.timer);
      if (document.visibilityState === "hidden") {
        run.channel.cancel();
        run.querying = false;
      } else if (["recovering", "tracking"].includes(current.current.lifecycle)) {
        void query.current();
      }
    };
    document.addEventListener("visibilitychange", visibility);
    const submitting = recoverable ? submissions.get(key) : undefined;
    if (submitting) void watchSubmission.current(run, submitting);
    else if (id) void query.current();
    return () => {
      document.removeEventListener("visibilitychange", visibility);
      disposeRun(run);
    };
  }, [commit, key, recoverable]);
  const start = useCallback(
    async (submit: () => Promise<HubOperation>) => {
      const run = runtime.current;
      if (
        !run ||
        !isActive(run) ||
        current.current.lifecycle === "submitting" ||
        operationId(current.current)
      )
        return;
      if (!recoverable) {
        await watchSubmission.current(run, (async () => submit())());
        return;
      }
      const submission = (async () => {
        const next = await submit();
        try {
          sessionStorage.setItem(key, next.operationId);
        } catch {
          /* Optional storage. */
        }
        return next;
      })().finally(() => submissions.delete(key));
      submissions.set(key, submission);
      await watchSubmission.current(run, submission);
    },
    [isActive, key, recoverable],
  );
  return {
    ...state,
    operationId: operationId(state),
    start,
    check: () => void query.current(),
    canCheck: operationId(state) !== null,
    busy: state.lifecycle === "submitting" || operationId(state) !== null,
  };
}

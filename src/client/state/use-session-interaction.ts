import { useCallback, useEffect, useRef, useState } from "react";

import type { InteractionKey } from "../../shared/api-contract";

import { api } from "../api/client";
import { messageFor } from "./request-errors";

export function useSessionInteraction(sessionId: string) {
  const [pendingOperation, setPendingOperation] = useState<"send" | "handoff" | null>(null);
  const [errorDetail, setErrorDetail] = useState<unknown>(null);
  const [error, setError] = useState<string | null>(null);
  const activeSessionId = useRef(sessionId);
  const generation = useRef(0);
  const mounted = useRef(true);
  const writing = useRef(false);

  if (activeSessionId.current !== sessionId) {
    activeSessionId.current = sessionId;
    generation.current += 1;
    writing.current = false;
  }

  useEffect(() => {
    setError(null);
    setPendingOperation(null);
  }, [sessionId]);

  const act = useCallback(
    async (
      operation: () => Promise<void>,
      {
        reportError = true,
        kind = "send",
      }: { reportError?: boolean; kind?: "send" | "handoff" } = {},
    ) => {
      if (!mounted.current || writing.current)
        throw new Error("An interaction is already in progress.");
      writing.current = true;
      const operationGeneration = ++generation.current;
      setPendingOperation(kind);
      if (reportError) setError(null);
      try {
        await operation();
      } catch (reason) {
        if (reportError && mounted.current && generation.current === operationGeneration) {
          setErrorDetail(reason);
          setError(messageFor(reason));
        }
        throw reason;
      } finally {
        if (generation.current === operationGeneration) writing.current = false;
        if (mounted.current && generation.current === operationGeneration) {
          setPendingOperation(null);
        }
      }
    },
    [],
  );

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      generation.current++;
    };
  }, []);

  return {
    pendingOperation,
    error,
    errorDetail: error === null ? null : errorDetail,
    clearError: () => setError(null),
    sendMessage: (message: string) => act(() => api.sendMessage(sessionId, message)),
    handoffPaneBinding: () => act(() => api.handoffPaneBinding(sessionId), { kind: "handoff" }),
    sendTerminalKeys: (keys: readonly InteractionKey[]) =>
      act(() => api.sendKeys(sessionId, keys), { reportError: false }),
    sendKeys: (keys: readonly InteractionKey[]) => act(() => api.sendKeys(sessionId, keys)),
  };
}

import { createContext, type ReactNode, useContext, useState } from "react";

import { nodeStorageKey } from "../node-path";

export interface DraftAttachment {
  id: string;
  file: File;
  path: string;
}

interface SessionDraft {
  text: string;
  attachments: DraftAttachment[];
}

function useDraftStore() {
  return useState(() => new Map<string, SessionDraft>());
}

const SessionDraftContext = createContext<ReturnType<typeof useDraftStore> | null>(null);

export function SessionDraftProvider({ children }: { children: ReactNode }) {
  const store = useDraftStore();
  return <SessionDraftContext value={store}>{children}</SessionDraftContext>;
}

export function useSessionDraft(sessionId: string) {
  const localStore = useDraftStore();
  const [drafts, setDrafts] = useContext(SessionDraftContext) ?? localStore;
  const key = nodeStorageKey(sessionId);
  const draft = drafts.get(key);
  const message = draft?.text ?? "";
  const attachments = draft?.attachments ?? [];
  const updateDraft = (update: (current: SessionDraft) => SessionDraft) => {
    setDrafts((current) => {
      const next = new Map(current);
      const updated = update(current.get(key) ?? { text: "", attachments: [] });
      if (updated.text || updated.attachments.length) next.set(key, updated);
      else next.delete(key);
      return next;
    });
  };
  const setMessage = (text: string) => updateDraft((current) => ({ ...current, text }));
  const addAttachment = (attachment: DraftAttachment) =>
    updateDraft((current) => ({ ...current, attachments: [...current.attachments, attachment] }));
  const removeAttachment = (id: string) =>
    updateDraft((current) => ({
      ...current,
      attachments: current.attachments.filter((attachment) => attachment.id !== id),
    }));
  const clearSentMessage = () => {
    setDrafts((current) => {
      // Compare edit identity, not text: a newer draft may contain the same text.
      if (current.get(key) !== draft) return current;
      const next = new Map(current);
      next.delete(key);
      return next;
    });
  };
  return { message, setMessage, attachments, addAttachment, removeAttachment, clearSentMessage };
}

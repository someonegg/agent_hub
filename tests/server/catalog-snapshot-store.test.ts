import { describe, expect, it } from "vitest";

import type { DomainSessionId, NormalizedSession } from "../../src/server/domain/session-domain.js";
import {
  type CatalogSnapshot,
  CatalogSnapshotStore,
} from "../../src/server/repository/catalog-snapshot-store.js";
import type { SessionSource, SourceSessionEntry } from "../../src/server/source/session-source.js";

describe("CatalogSnapshotStore incremental derivation", () => {
  it("reuses unchanged sessions when another session changes or disappears", async () => {
    const one = normalizedSession("one", "One");
    let signature = "initial";
    let entries = [sourceEntry("one", one), sourceEntry("two", normalizedSession("two", "Two"))];
    const store = new CatalogSnapshotStore([mutableSource(() => ({ signature, entries }))]);
    const first = await store.current();
    const id = idByTitle(first, "One");
    entries = [sourceEntry("one", one), sourceEntry("two", normalizedSession("two", "Updated"))];
    signature = "changed";
    const changed = await store.refresh();
    expect(changed.sessions.get(id)).toBe(first.sessions.get(id));
    entries = [entries[0]!];
    signature = "deleted";
    const deleted = await store.refresh();
    expect(deleted.sessions.size).toBe(1);
    expect(deleted.sessions.get(id)).toBe(first.sessions.get(id));
  });
});

const TEST_ORIGIN = {
  sourceType: "test",
  agent: "test",
  runtimeName: "Test",
  runtimeVersion: null,
} as const;

function mutableSource(
  state: () => {
    signature: string;
    entries: readonly SourceSessionEntry[];
  },
): SessionSource {
  return {
    descriptor: {
      sourceType: "test",
      instanceKey: "test",
      agent: "test",
      displayName: "Test",
    },
    async refresh() {
      const current = state();
      return {
        signature: current.signature,
        sessions: current.entries.map((entry) => ({ ...entry })),
        diagnostics: [],
      };
    },
  };
}

function sourceEntry(
  localId: string,
  normalized: NormalizedSession,
  nativeSessionId = localId,
): SourceSessionEntry {
  return {
    localId,
    nativeSessionId,
    origin: TEST_ORIGIN,
    normalized,
  };
}

function normalizedSession(id: string, title: string): NormalizedSession {
  return {
    session: {
      id,
      sourceId: id,
      origin: TEST_ORIGIN,
      title,
      workingDirectory: null,
      projectDirectory: null,
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
      archived: false,
      warningCount: 0,
      diagnostics: [],
    },
    timeline: [],
  };
}

function idByTitle(snapshot: CatalogSnapshot, title: string): DomainSessionId {
  const matches = [...snapshot.sessions].filter(([, value]) => value.session.title === title);
  if (matches.length !== 1) {
    throw new Error(`Expected one session titled ${title}, found ${matches.length}`);
  }
  return matches[0]![0];
}

it("waits for all failed-refresh sources to settle before allowing a retry", async () => {
  let markStarted!: () => void;
  const started = new Promise<void>((resolve) => {
    markStarted = resolve;
  });
  let releaseSource!: () => void;
  const released = new Promise<void>((resolve) => {
    releaseSource = resolve;
  });
  let active = 0;
  let calls = 0;
  let fail = true;
  const slow: SessionSource = {
    descriptor: { sourceType: "test", instanceKey: "slow", agent: "slow", displayName: "Slow" },
    async refresh() {
      expect(active).toBe(0);
      active++;
      calls++;
      markStarted();
      await released;
      active--;
      return { signature: "empty", sessions: [], diagnostics: [] };
    },
  };
  const broken: SessionSource = {
    descriptor: {
      sourceType: "test",
      instanceKey: "broken",
      agent: "broken",
      displayName: "Broken",
    },
    async refresh() {
      if (fail) throw new Error("source failure");
      return { signature: "empty", sessions: [], diagnostics: [] };
    },
  };
  const store = new CatalogSnapshotStore([slow, broken]);
  const first = store.refresh();
  const rejected = expect(first).rejects.toThrow("source failure");
  await started;
  const concurrent = expect(store.refresh()).rejects.toThrow("source failure");
  expect(calls).toBe(1);
  releaseSource();
  await Promise.all([rejected, concurrent]);
  fail = false;
  await store.refresh();
  expect(calls).toBe(2);
});

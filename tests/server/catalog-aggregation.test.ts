import { describe, expect, it, vi } from "vitest";

import { SessionApiMapper } from "../../src/server/api/session-api-mapper.js";
import {
  CatalogSnapshotStore,
  MAX_CATALOG_DIAGNOSTICS,
} from "../../src/server/repository/catalog-snapshot-store.js";
import type { SessionSource, SourceSessionEntry } from "../../src/server/source/session-source.js";
import { normalizedSession } from "../helpers/session-fixtures.js";

const normalized = normalizedSession();

describe("catalog source aggregation", () => {
  it("limits catalog diagnostics while preserving their order", async () => {
    const diagnostics = Array.from({ length: MAX_CATALOG_DIAGNOSTICS + 1 }, (_, index) => ({
      code: `catalog_warning_${index + 1}`,
      severity: "warning" as const,
      message: `Catalog warning ${index + 1}`,
      ordinal: null,
    }));
    const source = {
      ...testSource("catalog-diagnostics", [sourceEntry("one", "Healthy")]),
      async refresh() {
        return {
          signature: "catalog-diagnostics",
          sessions: [sourceEntry("one", "Healthy")],
          diagnostics,
        };
      },
    };

    const snapshot = await new CatalogSnapshotStore([source]).current();

    expect(snapshot.diagnostics).toEqual(diagnostics.slice(0, MAX_CATALOG_DIAGNOSTICS));
    expect(snapshot.sessions.size).toBe(1);
  });

  it("rejects duplicate local identities within a source", async () => {
    const entry = sourceEntry("same", "Duplicate");
    await expect(
      new CatalogSnapshotStore([testSource("broken", [entry, entry])]).current(),
    ).rejects.toThrow("Session source contract violation");
  });

  it("allows the same local identity in different sources", async () => {
    const entry = sourceEntry("same", "Session");
    const snapshot = await new CatalogSnapshotStore([
      testSource("first", [entry]),
      testSource("second", [entry]),
    ]).current();
    expect(snapshot.sessions.size).toBe(2);
  });

  it.each(["production", undefined])(
    "trusts source identities with NODE_ENV=%s",
    async (environment) => {
      vi.stubEnv("NODE_ENV", environment);
      try {
        const entry = sourceEntry("same", "Session");
        await expect(
          new CatalogSnapshotStore([testSource("source", [entry, entry])]).current(),
        ).resolves.toBeDefined();
      } finally {
        vi.unstubAllEnvs();
      }
    },
  );

  it("rejects duplicate source instances and propagates source invariant failures", async () => {
    const source = {
      descriptor: {
        sourceType: "test",
        instanceKey: "test-source",
        agent: "test-source",
        displayName: "Test",
      },
      refresh: vi.fn(async () => {
        throw new Error("source invariant");
      }),
    };
    expect(() => new CatalogSnapshotStore([source, source])).toThrow(
      "Duplicate session source instance key",
    );
    await expect(new CatalogSnapshotStore([source]).current()).rejects.toThrow("source invariant");
  });

  it("namespaces source identities, ignores source order", async () => {
    const sourceA = testSource("source-a", [
      sourceEntry("shared", "Source A shared"),
      sourceEntry("session-z", "Source A session Z"),
      sourceEntry("session-a", "Source A session A"),
    ]);
    const sourceAWithReorderedEntries = testSource("source-a", [
      sourceEntry("shared", "Source A shared"),
      sourceEntry("session-a", "Source A session A"),
      sourceEntry("session-z", "Source A session Z"),
    ]);
    const sourceB = testSource("source-b", [
      sourceEntry("shared", "Source B shared"),
      sourceEntry("another", "Source B another"),
    ]);
    const first = await new CatalogSnapshotStore([sourceA, sourceB]).current();
    const reordered = await new CatalogSnapshotStore([sourceB, sourceA]).current();
    const reorderedEntries = await new CatalogSnapshotStore([
      sourceAWithReorderedEntries,
      sourceB,
    ]).current();

    expect(first.signature).toBe(reordered.signature);
    expect(first.signature).toBe(reorderedEntries.signature);
    const mapper = new SessionApiMapper();
    expect(mapper.list([...first.sessions.values()].map((value) => value.session))).toEqual(
      mapper.list([...reordered.sessions.values()].map((value) => value.session)),
    );
    expect([...first.sessions.keys()].sort()).toEqual([...reordered.sessions.keys()].sort());
    const byTitle = new Map(
      [...first.sessions.values()].map((value) => [value.session.title, value.session]),
    );
    expect(byTitle.get("Source A shared")?.id).not.toBe(byTitle.get("Source B shared")?.id);
  });
});

function sourceEntry(nativeSessionId: string, title: string): SourceSessionEntry {
  const origin = {
    sourceType: "test",
    agent: "replaced-by-source",
    runtimeName: "Test",
    runtimeVersion: null,
  };
  return {
    localId: nativeSessionId,
    nativeSessionId,
    origin,
    normalized: {
      ...normalized,
      session: {
        ...normalized.session,
        id: nativeSessionId,
        sourceId: nativeSessionId,
        origin,
        title,
      },
    },
  };
}

function testSource(instanceKey: string, sessions: readonly SourceSessionEntry[]): SessionSource {
  return {
    descriptor: {
      sourceType: "test",
      instanceKey,
      agent: instanceKey,
      displayName: "Test",
    },
    async refresh() {
      return { signature: "stable", sessions, diagnostics: [] };
    },
  };
}

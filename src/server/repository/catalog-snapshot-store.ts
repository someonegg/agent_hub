import {
  type DomainBindingEvent,
  type DomainDiagnostic,
  type DomainSessionId,
  type NormalizedSession,
  sameSessionOrigin,
} from "../domain/session-domain.js";
import { opaqueIdForParts } from "../security/opaque-id.js";
import type {
  SessionSource,
  SessionSourceDescriptor,
  SessionSourceSnapshot,
  SourceBindingEvent,
  SourceSessionEntry,
} from "../source/session-source.js";
import { type DiagnosticLogger, RefreshDiagnosticLogger } from "./diagnostic-logger.js";
import { RefreshCoordinator } from "./refresh-coordinator.js";

export const DEFAULT_CATALOG_FRESHNESS_MS = 1_500;
export const MAX_CATALOG_DIAGNOSTICS = 50;

export interface CatalogSnapshot {
  readonly signature: string;
  readonly diagnostics: readonly DomainDiagnostic[];
  readonly sessions: ReadonlyMap<DomainSessionId, NormalizedSession>;
}

export interface CatalogSnapshotStoreDependencies {
  /** Called only after every source succeeds and the catalog is published. */
  readonly publishBindings?: (events: readonly DomainBindingEvent[]) => void;
  readonly diagnosticLogger?: DiagnosticLogger;
}

export class CatalogSnapshotStore {
  readonly #coordinator = new RefreshCoordinator<CatalogSnapshot>();
  readonly #diagnosticLogger: RefreshDiagnosticLogger;
  readonly #sources: readonly SessionSource[];
  #snapshot: CatalogSnapshot | null = null;
  readonly #observedSources = new Map<SessionSource, SessionSourceSnapshot>();
  readonly #pendingBindings = new Map<SessionSource, Set<SourceBindingEvent>>();
  readonly #publishBindings: NonNullable<CatalogSnapshotStoreDependencies["publishBindings"]>;
  #aggregate: AggregateState | null = null;
  #lastDiscoveryAt = Number.NEGATIVE_INFINITY;

  constructor(
    sources: readonly SessionSource[],
    private readonly freshnessMs = DEFAULT_CATALOG_FRESHNESS_MS,
    private readonly now: () => number = performance.now.bind(performance),
    dependencies: CatalogSnapshotStoreDependencies = {},
  ) {
    assertUniqueSources(sources);
    this.#publishBindings = dependencies.publishBindings ?? (() => {});
    this.#diagnosticLogger = new RefreshDiagnosticLogger(dependencies.diagnosticLogger);
    this.#sources = [...sources];
  }

  async current(): Promise<CatalogSnapshot> {
    const snapshot = this.#snapshot;
    if (snapshot !== null && this.now() - this.#lastDiscoveryAt < this.freshnessMs) {
      return snapshot;
    }
    return this.#coordinator.run(() => this.#discover());
  }

  async refresh(): Promise<CatalogSnapshot> {
    return this.#coordinator.run(() => this.#discover());
  }

  async #discover(): Promise<CatalogSnapshot> {
    const snapshot = await this.#rebuild();
    const bindings = [...this.#pendingBindings].flatMap(([source, events]) =>
      [...events].map(({ localId, ...event }) => ({
        ...event,
        sessionId: opaqueIdForParts(source.descriptor.instanceKey, localId),
      })),
    );
    this.#publishBindings(bindings);
    this.#pendingBindings.clear();
    this.#lastDiscoveryAt = this.now();
    return snapshot;
  }

  async #rebuild(): Promise<CatalogSnapshot> {
    // Wait for every source even on failure, so retries cannot overlap an unfinished refresh.
    const results = await Promise.allSettled(
      this.#sources.map(async (source) => {
        const snapshot = await source.refresh();
        if (this.#observedSources.get(source) !== snapshot) {
          const pending = this.#pendingBindings.get(source) ?? new Set<SourceBindingEvent>();
          for (const event of snapshot.bindings ?? []) pending.add(event);
          this.#pendingBindings.set(source, pending);
          this.#observedSources.set(source, snapshot);
        }
        return { descriptor: source.descriptor, snapshot };
      }),
    );
    const loadedSources = results.map((result) => {
      if (result.status === "rejected") throw result.reason;
      return result.value;
    });
    const signature = aggregateSignature(loadedSources);
    const previous = this.#snapshot;
    if (previous?.signature === signature) {
      this.#diagnosticLogger.update(loadedSources);
      return previous;
    }

    const sourceDiagnostics: DomainDiagnostic[] = [];
    for (const { snapshot } of loadedSources) {
      if (sourceDiagnostics.length >= MAX_CATALOG_DIAGNOSTICS) break;
      for (const item of snapshot.diagnostics) {
        if (sourceDiagnostics.length >= MAX_CATALOG_DIAGNOSTICS) break;
        sourceDiagnostics.push({ ...item });
      }
    }
    const aggregate = aggregateSessions(loadedSources, this.#aggregate);
    const snapshot: CatalogSnapshot = {
      signature,
      diagnostics: sourceDiagnostics,
      sessions: aggregate.sessions,
    };
    this.#aggregate = aggregate;
    this.#snapshot = snapshot;
    this.#diagnosticLogger.update(loadedSources);
    return snapshot;
  }
}

interface LoadedSource {
  readonly descriptor: SessionSourceDescriptor;
  readonly snapshot: SessionSourceSnapshot;
}

interface PendingSession {
  readonly descriptor: SessionSourceDescriptor;
  readonly nativeSessionId: string;
  readonly origin: SourceSessionEntry["origin"];
  readonly normalized: NormalizedSession;
}

interface AggregateState {
  readonly inputs: ReadonlyMap<DomainSessionId, PendingSession>;
  readonly sessions: ReadonlyMap<DomainSessionId, NormalizedSession>;
}

function assertUniqueSources(sources: readonly SessionSource[]): void {
  for (const field of ["instanceKey", "agent"] as const) {
    const keys = new Set<string>();
    for (const { descriptor } of sources) {
      const key = descriptor[field];
      if (!key.trim()) throw new Error(`Empty session source ${field}`);
      if (keys.has(key)) {
        const label = field === "instanceKey" ? "instance key" : field;
        throw new Error(`Duplicate session source ${label}: ${key}`);
      }
      keys.add(key);
    }
  }
}

function aggregateSignature(sources: readonly LoadedSource[]): string {
  return JSON.stringify(
    [...sources]
      .sort((left, right) =>
        left.descriptor.instanceKey.localeCompare(right.descriptor.instanceKey),
      )
      .map(({ descriptor, snapshot }) => ({
        source: descriptor.instanceKey,
        signature: snapshot.signature,
      })),
  );
}

function aggregateSessions(
  sources: readonly LoadedSource[],
  previous: AggregateState | null,
): AggregateState {
  const inputs = new Map<DomainSessionId, PendingSession>();
  for (const { descriptor, snapshot } of sources) {
    const localIds =
      process.env.NODE_ENV === "development" || process.env.NODE_ENV === "test"
        ? new Set<string>()
        : null;
    for (const entry of snapshot.sessions) {
      if (localIds?.has(entry.localId)) {
        throw new Error(
          `Session source contract violation: duplicate localId ${entry.localId} from ${descriptor.agent}`,
        );
      }
      localIds?.add(entry.localId);
      const id = opaqueIdForParts(descriptor.instanceKey, entry.localId);
      const input: PendingSession = {
        descriptor,
        nativeSessionId: entry.nativeSessionId,
        origin: entry.origin,
        normalized: entry.normalized,
      };
      inputs.set(id, input);
    }
  }

  const sessions = new Map<DomainSessionId, NormalizedSession>();
  for (const [id, item] of inputs) {
    const cached = previous?.sessions.get(id);
    const oldInput = previous?.inputs.get(id);
    if (cached !== undefined && oldInput !== undefined && sameSourceInput(oldInput, item)) {
      sessions.set(id, cached);
      continue;
    }
    const source = item.normalized.session;
    sessions.set(id, {
      session: {
        ...source,
        id,
        sourceId: item.nativeSessionId,
        origin: {
          ...item.origin,
          sourceType: item.descriptor.sourceType,
          agent: item.descriptor.agent,
          runtimeName: item.descriptor.displayName,
        },
      },
      timeline: item.normalized.timeline,
      interaction: item.normalized.interaction ?? null,
    });
  }
  return {
    sessions,
    inputs,
  };
}

function sameSourceInput(left: PendingSession, right: PendingSession): boolean {
  return (
    left.normalized === right.normalized &&
    left.nativeSessionId === right.nativeSessionId &&
    sameSessionOrigin(left.origin, right.origin) &&
    left.descriptor.sourceType === right.descriptor.sourceType &&
    left.descriptor.agent === right.descriptor.agent &&
    left.descriptor.displayName === right.descriptor.displayName
  );
}

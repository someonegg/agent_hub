import { open } from "node:fs/promises";
import { resolve } from "node:path";
import { performance } from "node:perf_hooks";

import type {
  DomainDiagnostic,
  DomainSession,
  DomainSessionOrigin,
  NormalizedSession,
} from "../../domain/session-domain.js";
import type {
  SessionSource,
  SessionSourceDescriptor,
  SessionSourceSnapshot,
  SourceBindingEvent,
  SourceSessionEntry,
} from "../../source/session-source.js";
import { mergeBindingMetadata } from "../shared/binding-protocol.js";
import {
  CheckpointedJsonlDecoder,
  type DecodedRecord,
  isObject,
  type JsonlCheckpoint,
  type JsonlDecoder,
} from "../shared/jsonl-decoder.js";
import { MAX_SESSION_DIAGNOSTICS } from "../shared/limits.js";
import {
  acceptedPathOrder,
  type FileFingerprint,
  fingerprintOf,
  mutableTelemetry,
  type RefreshTelemetry,
  sameFingerprint,
} from "../shared/source-cache.js";
import { type IdentityAccumulatorState, IdentityResolver } from "./identity-resolver.js";
import { codexBindingAttemptsFrom, codexInteraction } from "./interaction-parser.js";
import { isExpectedIoError } from "./io-errors.js";
import { JsonlCatalogSource } from "./jsonl-catalog-source.js";
import type { RolloutDescriptor } from "./rollout-descriptor.js";
import { SessionIndexReader } from "./session-index-reader.js";
import {
  DefaultSessionNormalizer,
  type SessionNormalizer,
  type SessionNormalizerState,
} from "./session-normalizer.js";

interface CodexCacheEntry {
  readonly descriptor: RolloutDescriptor;
  readonly fingerprint: FileFingerprint;
  readonly normalized: NormalizedSession;
  readonly threadId: string | null;
  readonly origin: DomainSessionOrigin;
  readonly checkpoint: JsonlCheckpoint;
  readonly identityState: IdentityAccumulatorState;
  readonly normalizerState: SessionNormalizerState;
  readonly bindProjectDirectory: string | null;
}

type ExcludedRollout = { reason: "non-primary" } | { reason: "duplicate"; threadId: string };

export class CodexSessionSource implements SessionSource {
  readonly descriptor: SessionSourceDescriptor;
  #cache = new Map<string, CodexCacheEntry>();
  #excluded = new Map<string, ExcludedRollout>();
  #snapshot: SessionSourceSnapshot | null = null;
  #lastRefreshTelemetry: RefreshTelemetry = mutableTelemetry();

  private readonly decoder: JsonlDecoder;
  private readonly identity: IdentityResolver;
  private readonly normalizer: SessionNormalizer;
  private readonly sessionIndex: SessionIndexReader;

  constructor(
    private readonly configDirectory: string,
    instanceKey: string,
    {
      decoder = new CheckpointedJsonlDecoder(),
      identity = new IdentityResolver(),
      normalizer = new DefaultSessionNormalizer(),
      sessionIndex = new SessionIndexReader(configDirectory),
      agent = "default",
    }: CodexSourceOptions = {},
  ) {
    this.decoder = decoder;
    this.identity = identity;
    this.normalizer = normalizer;
    this.sessionIndex = sessionIndex;
    this.descriptor = { sourceType: "codex-jsonl", instanceKey, agent, displayName: "Codex" };
  }

  async refresh(): Promise<SessionSourceSnapshot> {
    await this.sessionIndex.refresh();
    const archivedDescriptors = new Map(
      [...this.#cache.values()]
        .filter((entry) => entry.descriptor.archived)
        .map((entry) => [entry.descriptor.path, entry.descriptor] as const),
    );
    const discovery = await new JsonlCatalogSource(
      this.configDirectory,
      archivedDescriptors,
    ).discover();
    const discoverySignature = JSON.stringify({
      diagnostics: discovery.diagnostics,
      entries: discovery.entries.map(({ descriptor }) => fingerprintOf(descriptor)),
    });
    const nextCache = new Map<string, CodexCacheEntry>();
    const nextExcluded = new Map<string, ExcludedRollout>();
    const binds = new Map<string, Omit<SourceBindingEvent, "localId">[]>();
    const telemetry = mutableTelemetry();
    const unavailableRollouts: string[] = [];
    const loadDiagnostics: DomainDiagnostic[] = [];
    const acceptedThreads = new Set<string>();
    const duplicateThreads = new Set<string>();
    // Previously accepted paths take precedence; discovery order breaks first-scan ties.
    const candidates = [...discovery.entries].sort((left, right) =>
      acceptedPathOrder(
        this.#cache,
        left.descriptor.sourceRelativePath,
        right.descriptor.sourceRelativePath,
      ),
    );
    for (const { descriptor } of candidates) {
      const fingerprint = fingerprintOf(descriptor);
      const excluded = this.#excluded.get(descriptor.sourceRelativePath);
      if (excluded) {
        nextExcluded.set(descriptor.sourceRelativePath, excluded);
        if (excluded.reason === "duplicate") duplicateThreads.add(excluded.threadId);
        continue;
      }
      const cached = this.#cache.get(descriptor.sourceRelativePath);
      let loaded: CodexCacheEntry | "non-primary" | null;
      if (cached !== undefined && sameFingerprint(cached.fingerprint, fingerprint)) {
        loaded = cached;
      } else {
        loaded = await this.#load(descriptor, fingerprint, cached, telemetry, binds);
      }
      if (loaded === "non-primary") {
        nextExcluded.set(descriptor.sourceRelativePath, { reason: "non-primary" });
        continue;
      }
      if (loaded === null) {
        unavailableRollouts.push(descriptor.sourceRelativePath);
        loadDiagnostics.push(rolloutUnavailableDiagnostic());
        continue;
      }
      if (loaded.threadId !== null) {
        if (acceptedThreads.has(loaded.threadId)) {
          nextExcluded.set(descriptor.sourceRelativePath, {
            reason: "duplicate",
            threadId: loaded.threadId,
          });
          duplicateThreads.add(loaded.threadId);
          binds.delete(descriptor.id);
          continue;
        }
        acceptedThreads.add(loaded.threadId);
      }
      nextCache.set(descriptor.sourceRelativePath, loaded);
    }
    const sessions = sourceEntries(nextCache);
    const diagnostics = [
      ...discovery.diagnostics.map((item) => ({ ...item })),
      ...loadDiagnostics,
      ...[...duplicateThreads].map(
        (): DomainDiagnostic => ({
          code: "duplicate_native_session_id",
          severity: "warning",
          message:
            "Multiple Codex rollouts declared the same native session ID; duplicate rollouts were ignored.",
          ordinal: null,
        }),
      ),
    ].slice(0, MAX_SESSION_DIAGNOSTICS);
    const bindings = sessions.flatMap((entry) =>
      (binds.get(entry.normalized.session.id) ?? []).map((event) => ({
        ...event,
        localId: entry.localId,
      })),
    );
    const signature = JSON.stringify({
      discoverySignature,
      unavailableRollouts,
      projects: sessions.map((entry) => [
        entry.localId,
        entry.normalized.session.projectDirectory,
        entry.normalized.session.taskName ?? null,
      ]),
    });
    const snapshot = { signature, sessions, diagnostics, bindings };
    this.#cache = nextCache;
    this.#excluded = nextExcluded;
    this.#lastRefreshTelemetry = telemetry;
    if (this.#snapshot?.signature === signature) return this.#snapshot;
    this.#snapshot = snapshot;
    return snapshot;
  }

  lastRefreshTelemetry(): RefreshTelemetry {
    return { ...this.#lastRefreshTelemetry };
  }

  displayTitleFor(session: DomainSession): string | null {
    if (session.origin.agent !== this.descriptor.agent || session.sourceId === null) return null;
    return this.sessionIndex.threadName(session.sourceId);
  }

  async #load(
    descriptor: RolloutDescriptor,
    fingerprint: FileFingerprint,
    cached: CodexCacheEntry | undefined,
    telemetry: RefreshTelemetry,
    binds: Map<string, Omit<SourceBindingEvent, "localId">[]>,
  ): Promise<CodexCacheEntry | "non-primary" | null> {
    try {
      if (cached === undefined) {
        const head = await probeIdentity(descriptor, telemetry);
        const state = this.identity.append(this.identity.create(descriptor), head.records);
        // A filename match cannot be superseded by later metadata. At EOF the
        // first metadata is also definitive; otherwise use the complete decoder.
        if (
          (state.firstMatchingMetadata !== null || head.eof) &&
          this.identity.metadata(state).excluded
        )
          return "non-primary";
      }
      const decodeStartedAt = performance.now();
      const decoded = await this.decoder.decode(descriptor, cached?.checkpoint);
      telemetry.decodeMs += performance.now() - decodeStartedAt;
      telemetry.probeBytes += decoded.telemetry.probeBytes;
      telemetry.decodeBytes += decoded.telemetry.decodeBytes;
      telemetry[decoded.mode === "append" ? "appendFiles" : "fullFiles"] += 1;

      const normalizeStartedAt = performance.now();
      const identityBase =
        decoded.mode === "append" && cached !== undefined
          ? cached.identityState
          : this.identity.create(descriptor);
      const identityState = this.identity.append(identityBase, decoded.records);
      const metadata = this.identity.metadata(identityState);
      if (metadata.excluded) return "non-primary";
      const normalizerBase =
        decoded.mode === "append" && cached !== undefined
          ? cached.normalizerState
          : this.normalizer.create(descriptor);

      const normalizerState = this.normalizer.append(
        normalizerBase,
        decoded.records,
        decoded.diagnostics,
      );
      const bindingEvents = decoded.records.flatMap((record) => {
        const timestamp =
          typeof record.value.timestamp === "string" ? Date.parse(record.value.timestamp) : NaN;
        return codexBindingAttemptsFrom(record).map((attempt, position) => ({
          time: Number.isFinite(timestamp) ? timestamp : 0,
          ordinal: record.ordinal,
          position,
          attempt,
        }));
      });
      binds.set(descriptor.id, bindingEvents);
      const origin = this.#origin(metadata.runtimeVersion);
      const baseNormalized =
        decoded.mode === "append" &&
        cached !== undefined &&
        identityState === cached.identityState &&
        normalizerState === cached.normalizerState &&
        sameOrigin(origin, cached.origin)
          ? cached.normalized
          : this.normalizer.materialize(normalizerState, metadata, origin);
      const { projectDirectory: bindProjectDirectory, taskName } = mergeBindingMetadata(
        {
          projectDirectory:
            decoded.mode === "append" ? (cached?.bindProjectDirectory ?? null) : null,
          taskName:
            decoded.mode === "append" ? (cached?.normalized.session.taskName ?? null) : null,
        },
        bindingEvents.map((event) => event.attempt),
      );
      const projectDirectory = bindProjectDirectory ?? baseNormalized.session.workingDirectory;
      const normalized =
        baseNormalized === cached?.normalized &&
        projectDirectory === cached.normalized.session.projectDirectory &&
        (taskName ?? undefined) === cached.normalized.session.taskName
          ? cached.normalized
          : {
              ...baseNormalized,
              session: {
                ...baseNormalized.session,
                projectDirectory,
                taskName: taskName ?? undefined,
              },
              interaction: codexInteraction(projectDirectory, taskName ?? null),
            };
      telemetry.normalizeMs += performance.now() - normalizeStartedAt;
      return {
        descriptor,
        fingerprint,
        normalized,
        threadId: metadata.threadId,
        origin,
        checkpoint: decoded.checkpoint,
        identityState,
        normalizerState,
        bindProjectDirectory,
      };
    } catch (error) {
      if (!isExpectedIoError(error)) throw error;
      return null;
    }
  }

  #origin(runtimeVersion: string | null): DomainSessionOrigin {
    return {
      sourceType: this.descriptor.sourceType,
      agent: this.descriptor.agent,
      runtimeName: this.descriptor.displayName,
      runtimeVersion,
    };
  }
}

export interface CodexSourceOptions {
  readonly decoder?: JsonlDecoder;
  readonly identity?: IdentityResolver;
  readonly normalizer?: SessionNormalizer;
  readonly sessionIndex?: SessionIndexReader;
  readonly agent?: string;
}

export async function createCodexSessionSource(
  configDirectory: string,
  options: CodexSourceOptions = {},
) {
  const configured = resolve(configDirectory);
  return new CodexSessionSource(configured, `codex-jsonl\0${configured}`, options);
}

function sourceEntries(cache: ReadonlyMap<string, CodexCacheEntry>): SourceSessionEntry[] {
  const sessions: SourceSessionEntry[] = [];
  for (const entry of cache.values()) {
    const { threadId } = entry;
    sessions.push({
      localId: sourceLocalId(threadId, entry.fingerprint.sourceRelativePath),
      nativeSessionId: threadId,
      origin: entry.origin,
      normalized: entry.normalized,
    });
  }
  return sessions;
}

function sourceLocalId(threadId: string | null, sourceRelativePath: string): string {
  if (threadId === null) return `resource:${sourceRelativePath}`;
  return `thread:${threadId}`;
}

function rolloutUnavailableDiagnostic(): DomainDiagnostic {
  return {
    code: "rollout_unavailable",
    severity: "warning",
    message: "A registered rollout could not be read.",
    ordinal: null,
  };
}

function sameOrigin(left: DomainSessionOrigin, right: DomainSessionOrigin): boolean {
  return (
    left.sourceType === right.sourceType &&
    left.agent === right.agent &&
    left.runtimeName === right.runtimeName &&
    left.runtimeVersion === right.runtimeVersion
  );
}

const IDENTITY_HEAD_BYTES = 64 * 1024;

async function probeIdentity(
  descriptor: RolloutDescriptor,
  telemetry: RefreshTelemetry,
): Promise<{ records: DecodedRecord[]; eof: boolean }> {
  const handle = await open(descriptor.path, "r");
  try {
    const info = await handle.stat();
    const buffer = Buffer.alloc(Math.min(info.size, IDENTITY_HEAD_BYTES));
    let length = 0;
    while (length < buffer.length) {
      const read = await handle.read(buffer, length, buffer.length - length, length);
      telemetry.probeBytes += read.bytesRead;
      if (read.bytesRead === 0) break;
      length += read.bytesRead;
    }
    const text = buffer.subarray(0, length).toString("utf8");
    const lines = text.split("\n");
    lines.pop(); // Only newline-terminated JSONL records are eligible for probing.
    const records: DecodedRecord[] = [];
    for (const [index, line] of lines.entries()) {
      try {
        const value: unknown = JSON.parse(line);
        if (isObject(value)) records.push({ ordinal: index + 1, value });
      } catch {
        /* The full decoder owns malformed-record diagnostics. */
      }
    }
    return { records, eof: length === info.size && text.endsWith("\n") };
  } finally {
    await handle.close();
  }
}

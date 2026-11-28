import { readdir, stat } from "node:fs/promises";
import { join, relative, resolve } from "node:path";

import type { DomainDiagnostic, NormalizedSession } from "../../domain/session-domain.js";
import { sessionTitleFromMarkdown } from "../../domain/session-text.js";
import type {
  SessionSource,
  SessionSourceDescriptor,
  SessionSourceSnapshot,
  SourceBindingEvent,
  SourceSessionEntry,
} from "../../source/session-source.js";
import { discoverArchivedFiles, readSessionFiles } from "../shared/file-archive.js";
import { isExpectedIoError as expectedIo } from "../shared/io-errors.js";
import {
  CheckpointedJsonlDecoder,
  type DecodedRecord,
  type JsonlCheckpoint,
  type JsonlHeadCheck,
} from "../shared/jsonl-decoder.js";
import { MAX_SESSION_DIAGNOSTICS } from "../shared/limits.js";
import {
  acceptedPathOrder,
  type FileFingerprint,
  mutableTelemetry,
  sameFingerprint,
} from "../shared/source-cache.js";
import { validAgyId } from "./identity.js";
import {
  agyInteraction,
  isAgyUserInput,
  parseAgyBindingRecord,
  type ParsedAgyBindingRecord,
} from "./interaction.js";
import { agyTranscriptPath } from "./paths.js";
import {
  agyDecoderDiagnostics,
  type AgyState,
  appendAgyRecords,
  createAgyState,
} from "./session-normalizer.js";

const HEAD_BYTES = 64 * 1024;

interface CacheEntry {
  readonly fingerprint: FileFingerprint;
  readonly checkpoint: JsonlCheckpoint;
  readonly state: AgyState;
  readonly entry: SourceSessionEntry;
}

/** Only sessions whose first user message is a valid agent-hub binding are managed. */
function createHeadCheck(fileSize: number, onDecided: () => void): JsonlHeadCheck {
  return {
    maxBytes: HEAD_BYTES,
    inspect(records: readonly DecodedRecord[]) {
      const first = records.find((record) => isAgyUserInput(record.value));
      if (first) {
        if (parseAgyBindingRecord(first)?.event.attempt.valid) return "continue";
        onDecided();
        return "stop";
      }
      if (fileSize >= HEAD_BYTES) onDecided();
      return "stop";
    },
  };
}

export class AgySessionSource implements SessionSource {
  readonly descriptor: SessionSourceDescriptor;
  #decoder = new CheckpointedJsonlDecoder();
  #snapshot: SessionSourceSnapshot | null = null;
  #telemetry = mutableTelemetry();
  lastRefreshTelemetry() {
    return { ...this.#telemetry };
  }
  #cache = new Map<string, CacheEntry>();
  // A null fingerprint marks a file that the head check rejected permanently.
  #rejected = new Map<string, FileFingerprint | null>();
  constructor(
    private readonly directory: string,
    instanceKey: string,
    { agent = "agy" }: { readonly agent?: string } = {},
  ) {
    this.descriptor = {
      sourceType: "agy-jsonl",
      instanceKey,
      agent,
      displayName: "Antigravity",
    };
  }
  async refresh(): Promise<SessionSourceSnapshot> {
    const diagnostics: DomainDiagnostic[] = [];
    const bindings: SourceBindingEvent[] = [];
    this.#telemetry = mutableTelemetry();
    const warn = (...items: readonly DomainDiagnostic[]) => {
      diagnostics.push(
        ...items.slice(0, Math.max(0, MAX_SESSION_DIAGNOSTICS - diagnostics.length)),
      );
    };
    const next = new Map<string, CacheEntry>();
    const rejected = new Map<string, FileFingerprint | null>();
    const seen = new Set<string>();
    const candidates = [
      ...(await readSessionFiles(
        () => discoverAgyFiles(this.directory),
        warn,
        "Antigravity brain directory",
      )),
      ...(await readSessionFiles(
        () => discoverArchivedFiles(this.directory, validAgyId),
        warn,
        "Antigravity archive directory",
      )),
    ];
    candidates.sort(
      (a, b) =>
        Number(a.archived) - Number(b.archived) ||
        acceptedPathOrder(
          this.#cache,
          relative(this.directory, a.path),
          relative(this.directory, b.path),
        ),
    );
    for (const { path, nativeId, archived } of candidates) {
      if (seen.has(nativeId)) {
        warn({
          code: "duplicate_native_session_id",
          severity: "warning",
          message: "Duplicate Antigravity session file ignored",
          ordinal: null,
        });
        continue;
      }
      const key = relative(this.directory, path);
      const oldAccepted = this.#cache.get(key);
      const oldRejected = this.#rejected.get(key);
      let decoded;
      let fingerprint: FileFingerprint;
      try {
        const info = await stat(path);
        if (oldRejected === null) {
          rejected.set(key, null);
          continue;
        }
        fingerprint = { sourceRelativePath: key, size: info.size, mtimeMs: info.mtimeMs };
        if (oldAccepted && sameFingerprint(oldAccepted.fingerprint, fingerprint)) {
          next.set(key, oldAccepted);
          seen.add(nativeId);
          continue;
        }
        if (oldRejected && sameFingerprint(oldRejected, fingerprint)) {
          rejected.set(key, oldRejected);
          continue;
        }
        let headDecided = false;
        const started = performance.now();
        decoded = oldAccepted
          ? await this.#decoder.decode({ path }, oldAccepted.checkpoint)
          : await this.#decoder.decode(
              { path },
              undefined,
              createHeadCheck(info.size, () => {
                headDecided = true;
              }),
            );
        this.#telemetry.decodeMs += performance.now() - started;
        this.#telemetry.probeBytes += decoded.telemetry.probeBytes;
        if (decoded.mode === "stopped") {
          rejected.set(key, headDecided ? null : fingerprint);
          continue;
        }
        this.#telemetry[decoded.mode === "append" ? "appendFiles" : "fullFiles"]++;
        this.#telemetry.decodeBytes += decoded.telemetry.decodeBytes;
      } catch (error) {
        if (!expectedIo(error)) throw error;
        if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
        warn({
          code: "session_unavailable",
          severity: "warning",
          message: "Antigravity session could not be read",
          ordinal: null,
        });
        continue;
      }
      const base =
        decoded.mode === "append" && oldAccepted ? oldAccepted.state : createAgyState(nativeId);
      const parsedBindings: ParsedAgyBindingRecord[] = [];
      const started = performance.now();
      const state = appendAgyRecords(
        base,
        decoded.records,
        agyDecoderDiagnostics(decoded.diagnostics),
        (binding) => parsedBindings.push(binding),
      );
      this.#telemetry.normalizeMs += performance.now() - started;
      const entry =
        oldAccepted !== undefined && oldAccepted.state === state
          ? oldAccepted.entry
          : materializeAgySession(state, this.descriptor, archived);
      const localId = entry.localId;
      next.set(key, { fingerprint, checkpoint: decoded.checkpoint, state, entry });
      seen.add(nativeId);
      bindings.push(...parsedBindings.map((event) => ({ ...event, localId })));
    }
    this.#cache = next;
    this.#rejected = rejected;
    const sessions = [...next.values()].map((cached) => cached.entry);
    const snapshot = {
      bindings,
      sessions,
      diagnostics,
      signature: JSON.stringify([
        [...next].map(([path, cached]) => [path, cached.fingerprint, cached.checkpoint]),
        diagnostics,
      ]),
    };
    if (this.#snapshot?.signature === snapshot.signature) return this.#snapshot;
    this.#snapshot = snapshot;
    return snapshot;
  }
}

export async function createAgySessionSource(
  configDirectory: string,
  options: { readonly agent?: string } = {},
) {
  const directory = resolve(configDirectory);
  return new AgySessionSource(directory, `agy-jsonl\0${directory}`, options);
}

async function discoverAgyFiles(home: string) {
  const brain = join(home, "brain");
  const candidates: { path: string; nativeId: string; archived: boolean }[] = [];
  for (const entry of (await readdir(brain, { withFileTypes: true })).sort((a, b) =>
    a.name.localeCompare(b.name),
  )) {
    if (!entry.isDirectory() || !validAgyId(entry.name)) continue;
    candidates.push({
      path: agyTranscriptPath(home, entry.name),
      nativeId: entry.name,
      archived: false,
    });
  }
  return candidates;
}

function materializeAgySession(
  state: AgyState,
  descriptor: SessionSourceDescriptor,
  archived: boolean,
): SourceSessionEntry {
  const { nativeId } = state;
  const origin = {
    sourceType: descriptor.sourceType,
    agent: descriptor.agent,
    runtimeName: descriptor.displayName,
    runtimeVersion: null,
  };
  const localId = `thread:${nativeId}`;
  const normalized: NormalizedSession = {
    session: {
      id: localId,
      sourceId: nativeId,
      origin,
      title:
        (state.firstUser ? sessionTitleFromMarkdown(state.firstUser) : null) ?? "Untitled session",
      workingDirectory: state.workingDirectory,
      projectDirectory: state.project,
      taskName: state.taskName,
      createdAt: state.createdAt,
      updatedAt: state.updatedAt,
      archived,
      warningCount: state.diagnostics.length,
      diagnostics: state.diagnostics,
    },
    timeline: state.timeline,
    interaction: agyInteraction(state.project, state.workingDirectory, state.taskName),
  };
  return { localId, nativeSessionId: nativeId, origin, normalized };
}

import { basename } from "node:path";

import type { DecodedRecord } from "../shared/jsonl-decoder.js";
import { isObject } from "../shared/jsonl-decoder.js";
import type { RolloutDescriptor } from "./rollout-descriptor.js";
import { nonEmptyString } from "./value-readers.js";

export interface SessionMetadata {
  threadId: string | null;
  runtimeVersion: string | null;
  title: string | null;
  workingDirectory: string | null;
  projectDirectory: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  archived: boolean;
  excluded: boolean;
}

interface RawMetadata {
  id: string | null;
  runtimeVersion: string | null;
  title: string | null;
  cwd: string | null;
  timestamp: string | null;
  excluded: boolean;
}

export interface IdentityAccumulatorState {
  readonly fileName: string;
  readonly archived: boolean;
  readonly firstMetadata: RawMetadata | null;
  readonly firstMatchingMetadata: RawMetadata | null;
  readonly hasFirstRecord: boolean;
  readonly firstRecordTimestamp: string | null;
  readonly lastTimestamp: string | null;
}

export class IdentityResolver {
  create(descriptor: RolloutDescriptor): IdentityAccumulatorState {
    return {
      fileName: basename(descriptor.path),
      archived: descriptor.archived,
      firstMetadata: null,
      firstMatchingMetadata: null,
      hasFirstRecord: false,
      firstRecordTimestamp: null,
      lastTimestamp: null,
    };
  }

  append(
    state: IdentityAccumulatorState,
    records: readonly DecodedRecord[],
  ): IdentityAccumulatorState {
    if (records.length === 0) return state;
    let firstMetadata = state.firstMetadata;
    let firstMatchingMetadata = state.firstMatchingMetadata;
    let hasFirstRecord = state.hasFirstRecord;
    let firstRecordTimestamp = state.firstRecordTimestamp;
    let lastTimestamp = state.lastTimestamp;

    for (const record of records) {
      const timestamp = timestampOf(record.value);
      if (!hasFirstRecord) {
        hasFirstRecord = true;
        firstRecordTimestamp = timestamp;
      }
      if (timestamp !== null) lastTimestamp = timestamp;
      if (record.value.type !== "session_meta") continue;
      const metadata = rawMetadata(record.value.payload);
      if (metadata === null) continue;
      firstMetadata ??= metadata;
      if (
        firstMatchingMetadata === null &&
        metadata.id !== null &&
        state.fileName.includes(metadata.id)
      )
        firstMatchingMetadata = metadata;
    }

    return {
      ...state,
      firstMetadata,
      firstMatchingMetadata,
      hasFirstRecord,
      firstRecordTimestamp,
      lastTimestamp,
    };
  }

  metadata(state: IdentityAccumulatorState): SessionMetadata {
    const raw = state.firstMatchingMetadata ?? state.firstMetadata;
    return {
      threadId: raw?.id ?? null,
      runtimeVersion: raw?.runtimeVersion ?? null,
      title: raw?.title ?? null,
      workingDirectory: raw?.cwd ?? null,
      projectDirectory: raw?.cwd ?? null,
      createdAt: raw?.timestamp ?? state.firstRecordTimestamp,
      updatedAt: state.lastTimestamp,
      archived: state.archived,
      excluded: raw?.excluded ?? false,
    };
  }
}

function rawMetadata(value: unknown): RawMetadata | null {
  if (!isObject(value)) return null;
  return {
    id: nonEmptyString(value.id),
    runtimeVersion: nonEmptyString(value.cli_version ?? value.agent_version),
    title: nonEmptyString(value.title),
    cwd: nonEmptyString(value.cwd),
    timestamp: nonEmptyString(value.timestamp),
    excluded: isNonPrimaryMetadata(value),
  };
}

function isNonPrimaryMetadata(value: Record<string, unknown>): boolean {
  const source = isObject(value.source) ? value.source : null;
  const marker = source?.subagent;
  return (
    nonEmptyString(value.parent_thread_id) !== null ||
    nonEmptyString(value.parent_id) !== null ||
    isObject(marker) ||
    nonEmptyString(marker) !== null
  );
}

function timestampOf(record: Record<string, unknown> | undefined): string | null {
  return record === undefined ? null : nonEmptyString(record.timestamp);
}

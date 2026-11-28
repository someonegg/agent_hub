import { randomUUID } from "node:crypto";
import { constants, copyFile, lstat, mkdir, readdir, rename, rm, unlink } from "node:fs/promises";
import { dirname, join } from "node:path";

import type { DomainDiagnostic } from "../../domain/session-domain.js";
import { isExpectedIoError } from "./io-errors.js";

const archiveDirectory = (home: string) => join(home, "ahub_archived_sessions");
export const archivePath = (home: string, id: string) =>
  join(archiveDirectory(home), `${id}.jsonl`);

export async function lstatIfPresent(path: string) {
  try {
    return await lstat(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    return undefined;
  }
}

export async function moveToArchive(source: string | undefined, destination: string) {
  const info = source ? await lstatIfPresent(source) : undefined;
  if (!source || !info) {
    if ((await lstatIfPresent(destination))?.isFile()) return;
    throw new Error("Session history file not found");
  }
  if (!info.isFile()) throw new Error("Session history is not a regular file");
  if (await lstatIfPresent(destination)) throw new Error("Session archive already exists");
  await mkdir(dirname(destination), { recursive: true });
  try {
    await rename(source, destination);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EXDEV") throw error;
    const temp = join(dirname(destination), `.${randomUUID()}.tmp`);
    try {
      await copyFile(source, temp, constants.COPYFILE_EXCL);
      if (await lstatIfPresent(destination)) throw new Error("Session archive already exists");
      await rename(temp, destination);
    } catch (copyError) {
      await rm(temp, { force: true });
      throw copyError;
    }
    await unlink(source);
  }
}

export async function cleanupAfterArchive(path: string, cleanup: () => Promise<void>) {
  try {
    await cleanup();
  } catch (error) {
    console.warn("Could not clean up archived session data", path, error);
  }
}

export async function readSessionFiles<T>(
  discover: () => Promise<T[]>,
  warn: (diagnostic: DomainDiagnostic) => void,
  directoryLabel: string,
): Promise<T[]> {
  try {
    return await discover();
  } catch (error) {
    if (!isExpectedIoError(error)) throw error;
    if ((error as NodeJS.ErrnoException).code !== "ENOENT")
      warn({
        code: "source_unavailable",
        severity: "warning",
        message: `${directoryLabel} could not be read`,
        ordinal: null,
      });
    return [];
  }
}

export async function discoverArchivedFiles(home: string, validId: (id: string) => boolean) {
  const candidates = [];
  for (const file of await readdir(archiveDirectory(home), { withFileTypes: true })) {
    if (!file.isFile() || !file.name.endsWith(".jsonl")) continue;
    const nativeId = file.name.slice(0, -6);
    if (validId(nativeId))
      candidates.push({ path: archivePath(home, nativeId), nativeId, archived: true });
  }
  return candidates;
}

import { randomBytes } from "node:crypto";
import { lstat, mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";

import { validTaskName } from "../../../shared/task-name.js";
import { validProjectDirectory } from "../../domain/project-directory.js";
import { validTmuxSessionName } from "../../interaction/tmux-target.js";
import type { TmuxBinding } from "../../interaction/transport.js";
import { isExpectedIoError } from "../shared/io-errors.js";
import { validClaudeId } from "./identity.js";

type BindingOperation =
  | { kind: "create"; operationId: string }
  | { kind: "resume"; operationId: string; nativeId: string }
  | { kind: "handoff" };

export type ClaudeBindingRecord = TmuxBinding &
  BindingOperation & {
    source: string;
  };

export interface ParsedClaudeBindingMessage {
  readonly id: string;
  readonly projectDirectory?: string;
  readonly taskName?: string;
}

const BINDING_PREFIX = 'Ignore this message and reply with only "OK". [ahub-bind:';
const BINDING_ID = /^[a-f0-9]{32}$/;

export const claudeSourceKey = (directory: string) => `claude-jsonl\0${resolve(directory)}`;

export function defaultClaudeBindingsDirectory(): string {
  const runtime = process.env.XDG_RUNTIME_DIR;
  if (process.platform === "linux" && runtime && isAbsolute(runtime)) {
    return join(runtime, "agent-hub", "bindings");
  }
  const uid = process.getuid?.();
  return join(tmpdir(), uid === undefined ? "agent-hub" : `agent-hub-${uid}`, "bindings");
}

export function validateClaudeBindingMetadata(
  projectDirectory: string | null,
  taskName: string | null,
): void {
  if (
    (projectDirectory !== null && !validProjectDirectory(projectDirectory)) ||
    (taskName !== null && (!validTaskName(taskName) || !taskName.trim()))
  ) {
    throw new Error("Invalid Claude binding record");
  }
}

export function formatClaudeBindingMessage(
  id: string,
  projectDirectory: string | null,
  taskName: string | null,
): string {
  if (!BINDING_ID.test(id)) throw new Error("Invalid Claude binding record");
  validateClaudeBindingMetadata(projectDirectory, taskName);
  const payload = {
    id,
    ...(projectDirectory !== null ? { project: projectDirectory } : {}),
    ...(taskName !== null ? { task: taskName.trim() } : {}),
  };
  return `${BINDING_PREFIX}${JSON.stringify(payload)}]`;
}

export function parseClaudeBindingMessage(message: string): ParsedClaudeBindingMessage | null {
  if (!message.startsWith(BINDING_PREFIX) || !message.endsWith("]")) return null;
  const raw = message.slice(BINDING_PREFIX.length, -1);
  if (/[\0\r\n]/.test(raw)) return null;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  for (const key of Object.keys(row)) {
    if (key !== "id" && key !== "project" && key !== "task") return null;
  }
  if (typeof row.id !== "string" || !BINDING_ID.test(row.id)) return null;
  const projectDirectory = validProjectDirectory(row.project) ? row.project : undefined;
  const taskName = validTaskName(row.task) && row.task.trim() ? row.task.trim() : undefined;
  return {
    id: row.id,
    ...(projectDirectory !== undefined ? { projectDirectory } : {}),
    ...(taskName !== undefined ? { taskName } : {}),
  };
}

export class ClaudeBindingIndex {
  constructor(
    private readonly directory: string,
    private readonly source: string,
  ) {}

  async publish(
    target: TmuxBinding,
    operation: BindingOperation,
    projectDirectory: string | null,
    taskName: string | null,
  ): Promise<string> {
    const record = { ...target, ...operation, source: this.source };
    if (!validRecord(record, this.source)) throw new Error("Invalid Claude binding record");
    const id = randomBytes(16).toString("hex");
    const message = formatClaudeBindingMessage(id, projectDirectory, taskName);
    const file = join(this.directory, `${id}.json`);
    const temporary = join(this.directory, `.${id}.tmp`);
    await ensurePrivateDirectory(this.directory);
    try {
      await writeFile(temporary, JSON.stringify(record), { flag: "wx", mode: 0o400 });
      await rename(temporary, file);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST")
        await unlink(temporary).catch(() => {});
      throw error;
    }
    return message;
  }

  async lookup(id: string, nativeId: string): Promise<ClaudeBindingRecord | null> {
    if (!BINDING_ID.test(id)) return null;
    try {
      if (!(await isPrivateDirectory(this.directory))) return null;
      const file = join(this.directory, `${id}.json`);
      const info = await lstat(file);
      if (!info.isFile() || info.isSymbolicLink() || !ownedByCurrentUser(info.uid)) return null;
      const value: unknown = JSON.parse(await readFile(file, "utf8"));
      if (!validRecord(value, this.source)) return null;
      return value.kind === "resume" && value.nativeId !== nativeId ? null : value;
    } catch (error) {
      if (error instanceof SyntaxError || isExpectedIoError(error)) return null;
      throw error;
    }
  }

  async discard(message: string): Promise<void> {
    const parsed = parseClaudeBindingMessage(message);
    if (!parsed) return;
    try {
      if (!(await isPrivateDirectory(this.directory))) return;
      await unlink(join(this.directory, `${parsed.id}.json`));
    } catch (error) {
      if (!isExpectedIoError(error)) throw error;
    }
  }
}

async function ensurePrivateDirectory(directory: string): Promise<void> {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  if (!(await isPrivateDirectory(directory))) {
    throw new Error("Unsafe Claude bindings directory");
  }
}

async function isPrivateDirectory(directory: string): Promise<boolean> {
  const info = await lstat(directory);
  return (
    info.isDirectory() &&
    !info.isSymbolicLink() &&
    ownedByCurrentUser(info.uid) &&
    (info.mode & 0o077) === 0
  );
}

function ownedByCurrentUser(uid: number): boolean {
  const current = process.getuid?.();
  return current === undefined || uid === current;
}

function validRecord(value: unknown, source: string): value is ClaudeBindingRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  if (
    row.source !== source ||
    !validProjectDirectory(row.socketPath) ||
    typeof row.sessionName !== "string" ||
    !validTmuxSessionName(row.sessionName)
  )
    return false;
  if (row.kind === "handoff") return row.operationId === undefined && row.nativeId === undefined;
  if (
    typeof row.operationId !== "string" ||
    !validClaudeId(row.operationId) ||
    row.sessionName !== `ahub-${row.operationId}`
  )
    return false;
  return row.kind === "create"
    ? row.nativeId === undefined
    : row.kind === "resume" && typeof row.nativeId === "string" && validClaudeId(row.nativeId);
}

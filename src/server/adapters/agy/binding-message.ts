import { TASK_NAME_ERROR, validTaskName } from "../../../shared/task-name.js";
import { validOperationId } from "../../domain/operation-id.js";
import { validProjectDirectory } from "../../domain/project-directory.js";
import type { InteractionBindingAttempt } from "../../domain/session-domain.js";
import { validTmuxSessionName } from "../../interaction/tmux-target.js";
import type { TmuxBinding } from "../../interaction/transport.js";
import { isObject } from "../shared/jsonl-decoder.js";

const BINDING_FIELDS = new Set([
  "socketPath",
  "sessionName",
  "operationId",
  "projectDirectory",
  "workingDirectory",
  "taskName",
]);
const BINDING_PREFIX = 'Ignore this message and reply with only "OK". [ahub-bind:';

export interface ParsedAgyBinding {
  readonly attempt: InteractionBindingAttempt;
  /** The launch directory is adapter-private evidence; the transcript has no cwd. */
  readonly workingDirectory?: string;
}

export function formatAgyBindingMessage(
  target: TmuxBinding,
  projectDirectory: string | null,
  workingDirectory: string | null,
  taskName: string | null,
  operationId?: string,
): string {
  if (!validProjectDirectory(target.socketPath) || !validTmuxSessionName(target.sessionName)) {
    throw new Error("Invalid Antigravity binding target");
  }
  if (operationId !== undefined && !validOperationId(operationId)) {
    throw new Error("Invalid operation ID");
  }
  if (taskName !== null && !validTaskName(taskName)) {
    throw new Error(TASK_NAME_ERROR);
  }
  const payload = {
    socketPath: target.socketPath,
    sessionName: target.sessionName,
    operationId,
    projectDirectory: validProjectDirectory(projectDirectory) ? projectDirectory : undefined,
    workingDirectory: validProjectDirectory(workingDirectory) ? workingDirectory : undefined,
    taskName: bindingTaskName(taskName),
  };
  return `${BINDING_PREFIX}${JSON.stringify(payload)}]`;
}

export function parseAgyBindingMessage(message: string, ordinal: number): ParsedAgyBinding | null {
  if (!message.startsWith(BINDING_PREFIX) || !message.endsWith("]")) return null;
  const raw = message.slice(BINDING_PREFIX.length, -1);
  if (/[\0\r\n]/.test(raw)) return null;
  const invalid = { attempt: { ordinal, valid: false } } as const;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return invalid;
  }
  if (!isObject(value)) return invalid;
  if (Object.keys(value).some((key) => !BINDING_FIELDS.has(key))) return null;
  const { socketPath, sessionName, operationId, projectDirectory, workingDirectory, taskName } =
    value;
  if (
    !validProjectDirectory(socketPath) ||
    typeof sessionName !== "string" ||
    !validTmuxSessionName(sessionName) ||
    (operationId !== undefined &&
      (typeof operationId !== "string" || !validOperationId(operationId)))
  )
    return invalid;

  const task = bindingTaskName(taskName);
  return {
    attempt: {
      ordinal,
      valid: true,
      socketPath,
      sessionName,
      ...(operationId !== undefined ? { operationId } : {}),
      ...(validProjectDirectory(projectDirectory) ? { projectDirectory } : {}),
      ...(task !== undefined ? { taskName: task } : {}),
    },
    ...(validProjectDirectory(workingDirectory) ? { workingDirectory } : {}),
  };
}

function bindingTaskName(value: unknown): string | undefined {
  return validTaskName(value) ? value.trim() || undefined : undefined;
}

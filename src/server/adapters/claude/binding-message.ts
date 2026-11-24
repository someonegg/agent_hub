import { TASK_NAME_ERROR, validTaskName } from "../../../shared/task-name.js";
import { validProjectDirectory } from "../../domain/project-directory.js";
import type { InteractionBindingAttempt } from "../../domain/session-domain.js";
import { validTmuxSessionName } from "../../interaction/tmux-target.js";
import type { TmuxBinding } from "../../interaction/transport.js";
import { isObject } from "../shared/jsonl-decoder.js";
import { validClaudeId } from "./identity.js";

const BINDING_FIELDS = new Set([
  "socketPath",
  "sessionName",
  "operationId",
  "projectDirectory",
  "taskName",
]);
const BINDING_PREFIX = 'Ignore this message and reply with only "OK". [ahub-bind:';

export function formatClaudeBindingMessage(
  target: TmuxBinding,
  projectDirectory: string | null,
  taskName: string | null,
  operationId?: string,
): string {
  if (!validProjectDirectory(target.socketPath) || !validTmuxSessionName(target.sessionName)) {
    throw new Error("Invalid Claude binding target");
  }
  if (operationId !== undefined && !validClaudeId(operationId)) {
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
    taskName: bindingTaskName(taskName),
  };
  return `${BINDING_PREFIX}${JSON.stringify(payload)}]`;
}

export function parseClaudeBindingMessage(
  message: string,
  ordinal: number,
): InteractionBindingAttempt | null {
  if (!message.startsWith(BINDING_PREFIX) || !message.endsWith("]")) return null;
  const raw = message.slice(BINDING_PREFIX.length, -1);
  if (/[\0\r\n]/.test(raw)) return null;
  const invalid = { ordinal, valid: false } as const;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return invalid;
  }
  if (!isObject(value)) return invalid;
  if (Object.keys(value).some((key) => !BINDING_FIELDS.has(key))) return null;
  const { socketPath, sessionName, operationId, projectDirectory, taskName } = value;
  if (
    !validProjectDirectory(socketPath) ||
    typeof sessionName !== "string" ||
    !validTmuxSessionName(sessionName) ||
    (operationId !== undefined && (typeof operationId !== "string" || !validClaudeId(operationId)))
  )
    return invalid;

  const task = bindingTaskName(taskName);
  return {
    ordinal,
    valid: true,
    socketPath,
    sessionName,
    ...(operationId !== undefined ? { operationId } : {}),
    ...(validProjectDirectory(projectDirectory) ? { projectDirectory } : {}),
    ...(task !== undefined ? { taskName: task } : {}),
  };
}

function bindingTaskName(value: unknown): string | undefined {
  return validTaskName(value) ? value.trim() || undefined : undefined;
}

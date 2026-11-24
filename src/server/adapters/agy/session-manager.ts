import { rm } from "node:fs/promises";
import { join } from "node:path";

import { TASK_NAME_ERROR, validTaskName } from "../../../shared/task-name.js";
import { TmuxLauncher } from "../../interaction/tmux-launcher.js";
import {
  type SessionLaunchOptions,
  type SessionManager,
} from "../../management/session-manager.js";
import { readLaunchEnvironment } from "../shared/launch-environment.js";
import { exitSteps, resolveDirectory } from "../shared/session-management.js";
import { formatAgyBindingMessage } from "./binding-message.js";
import { validAgyId } from "./identity.js";

export class AgySessionManager implements SessionManager {
  constructor(
    private readonly configDirectory: string,
    private readonly tmux: TmuxLauncher,
    private readonly command = "agy",
  ) {}
  isValidNativeId = validAgyId;
  resolveDirectory = resolveDirectory;
  async launch(options: SessionLaunchOptions) {
    if (options.resumeNativeId !== undefined && !this.isValidNativeId(options.resumeNativeId))
      throw new Error("Invalid resume identity");
    if (options.taskName !== undefined && !validTaskName(options.taskName))
      throw new Error(TASK_NAME_ERROR);
    const environment = await readLaunchEnvironment(this.configDirectory);
    // options.worktree is intentionally ignored: agy has no worktree support yet.
    return this.tmux.launchWithTarget(
      options.operationId,
      options.workingDirectory,
      (target) => {
        const prompt = formatAgyBindingMessage(
          target,
          options.projectDirectory ?? null,
          options.workingDirectory,
          options.taskName ?? null,
          options.operationId,
        );
        const command = [this.command];
        if (options.resumeNativeId) command.push("--resume", options.resumeNativeId);
        if (options.permissionMode === "auto") command.push("--mode", "auto");
        if (options.permissionMode === "yolo") command.push("--dangerously-skip-permissions");
        command.push("-i", prompt);
        return command;
      },
      environment,
    );
  }
  /** Best-effort removal of files named by the UUID; shared databases are never touched. */
  async delete(nativeId: string): Promise<void> {
    if (!this.isValidNativeId(nativeId)) throw new Error("Invalid Antigravity session identity");
    const root = this.configDirectory;
    await rm(join(root, "brain", nativeId), { recursive: true, force: true });
    for (const path of [
      join(root, "conversations", `${nativeId}.db`),
      join(root, "conversations", `${nativeId}.db-shm`),
      join(root, "conversations", `${nativeId}.db-wal`),
      join(root, "annotations", `${nativeId}.pbtxt`),
      join(root, "presence", `${nativeId}.lock`),
    ])
      await rm(path, { force: true });
  }
  exitSteps = exitSteps;
}
export const createAgySessionManager = (
  configDirectory: string,
  socket?: string,
  command?: string,
): SessionManager => new AgySessionManager(configDirectory, new TmuxLauncher(socket), command);

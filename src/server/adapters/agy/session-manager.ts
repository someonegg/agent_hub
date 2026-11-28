import { rm } from "node:fs/promises";
import { dirname, join } from "node:path";

import { TASK_NAME_ERROR, validTaskName } from "../../../shared/task-name.js";
import { TmuxLauncher } from "../../interaction/tmux-launcher.js";
import {
  type SessionLaunchOptions,
  type SessionManager,
} from "../../management/session-manager.js";
import { archivePath, cleanupAfterArchive, moveToArchive } from "../shared/file-archive.js";
import { readLaunchEnvironment } from "../shared/launch-environment.js";
import { exitSteps, resolveDirectory } from "../shared/session-management.js";
import { formatAgyBindingMessage } from "./binding-message.js";
import { validAgyId } from "./identity.js";
import { agyTranscriptPath } from "./paths.js";

export class AgySessionManager implements SessionManager {
  constructor(
    private readonly configDirectory: string,
    private readonly tmux: TmuxLauncher,
    private readonly command = "agy",
    private readonly trustWorkspaceForSession = false,
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
        if (this.trustWorkspaceForSession) {
          const trustedWorkspaces = [options.workingDirectory];
          if (options.projectDirectory && options.projectDirectory !== options.workingDirectory)
            trustedWorkspaces.push(options.projectDirectory);
          command.push("--settings", JSON.stringify({ trustedWorkspaces }));
        }
        if (options.resumeNativeId) command.push("--resume", options.resumeNativeId);
        if (options.permissionMode === "auto") command.push("--mode", "auto");
        if (options.permissionMode === "yolo") command.push("--dangerously-skip-permissions");
        command.push("-i", prompt);
        return command;
      },
      environment,
    );
  }
  async archive(nativeId: string): Promise<void> {
    if (!this.isValidNativeId(nativeId)) throw new Error("Invalid Antigravity session identity");
    const source = agyTranscriptPath(this.configDirectory, nativeId);
    await moveToArchive(source, archivePath(this.configDirectory, nativeId));
    for (const path of this.#sessionPaths(nativeId))
      await cleanupAfterArchive(path, () => this.#remove(path));
  }

  async delete(nativeId: string): Promise<void> {
    if (!this.isValidNativeId(nativeId)) throw new Error("Invalid Antigravity session identity");
    for (const path of this.#sessionPaths(nativeId)) await this.#remove(path);
    await rm(archivePath(this.configDirectory, nativeId), { force: true });
  }

  #sessionPaths(nativeId: string) {
    const root = this.configDirectory;
    return [
      join(root, "brain", nativeId),
      join(root, "conversations", `${nativeId}.db`),
      join(root, "conversations", `${nativeId}.db-shm`),
      join(root, "conversations", `${nativeId}.db-wal`),
      join(root, "annotations", `${nativeId}.pbtxt`),
      join(root, "presence", `${nativeId}.lock`),
    ];
  }

  #remove(path: string) {
    return rm(path, {
      recursive: dirname(path) === join(this.configDirectory, "brain"),
      force: true,
    });
  }
  exitSteps = exitSteps;
}
export const createAgySessionManager = (
  configDirectory: string,
  socket?: string,
  command?: string,
  trustWorkspaceForSession = false,
): SessionManager =>
  new AgySessionManager(
    configDirectory,
    new TmuxLauncher(socket),
    command,
    trustWorkspaceForSession,
  );

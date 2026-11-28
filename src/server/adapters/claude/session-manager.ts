import { readdir, rm, rmdir } from "node:fs/promises";
import { dirname, join } from "node:path";

import { TASK_NAME_ERROR, validTaskName } from "../../../shared/task-name.js";
import { TmuxLauncher } from "../../interaction/tmux-launcher.js";
import {
  type SessionLaunchOptions,
  type SessionManager,
} from "../../management/session-manager.js";
import {
  archivePath,
  cleanupAfterArchive,
  lstatIfPresent,
  moveToArchive,
} from "../shared/file-archive.js";
import { readLaunchEnvironment } from "../shared/launch-environment.js";
import { exitSteps, resolveDirectory } from "../shared/session-management.js";
import { formatClaudeBindingMessage } from "./binding-message.js";
import { validClaudeId } from "./identity.js";

export class ClaudeSessionManager implements SessionManager {
  constructor(
    private readonly configDirectory: string,
    private readonly tmux: TmuxLauncher,
    private readonly command = "claude",
  ) {}
  isValidNativeId = validClaudeId;
  resolveDirectory = resolveDirectory;
  async launch(options: SessionLaunchOptions) {
    if (options.resumeNativeId !== undefined && !this.isValidNativeId(options.resumeNativeId))
      throw new Error("Invalid resume identity");
    if (options.taskName !== undefined && !validTaskName(options.taskName))
      throw new Error(TASK_NAME_ERROR);
    const environment = {
      ...(await readLaunchEnvironment(this.configDirectory)),
      CLAUDE_CONFIG_DIR: this.configDirectory,
    };
    return this.tmux.launchWithTarget(
      options.operationId,
      options.workingDirectory,
      (target) => {
        const prompt = formatClaudeBindingMessage(
          target,
          options.projectDirectory ?? null,
          options.taskName ?? null,
          options.operationId,
        );
        const command = [this.command];
        if (options.resumeNativeId) command.push("--resume", options.resumeNativeId);
        if (options.worktree) command.push("--worktree");
        if (options.permissionMode === "auto") command.push("--permission-mode", "auto");
        if (options.permissionMode === "yolo") command.push("--dangerously-skip-permissions");
        // --worktree accepts an optional name. Keep the prompt positional.
        if (options.worktree) command.push("--");
        command.push(prompt);
        return command;
      },
      environment,
    );
  }
  async archive(nativeId: string): Promise<void> {
    if (!this.isValidNativeId(nativeId)) throw new Error("Invalid Claude session identity");
    const projects = await this.#projectDirectories();
    const sources = [];
    for (const project of projects) {
      const path = join(project, `${nativeId}.jsonl`);
      if (await lstatIfPresent(path)) sources.push(path);
    }
    if (sources.length > 1) throw new Error("Duplicate Claude session files");
    const source = sources[0];
    await moveToArchive(source, archivePath(this.configDirectory, nativeId));
    for (const directory of source ? [dirname(source)] : projects) {
      const session = join(directory, nativeId);
      await cleanupAfterArchive(session, () => this.#removeSubagents(session));
    }
  }

  async delete(nativeId: string): Promise<void> {
    if (!this.isValidNativeId(nativeId)) throw new Error("Invalid Claude session identity");
    for (const project of await this.#projectDirectories()) {
      await this.#removeSubagents(join(project, nativeId));
      await rm(join(project, `${nativeId}.jsonl`), { force: true });
    }
    await rm(archivePath(this.configDirectory, nativeId), { force: true });
  }

  async #projectDirectories() {
    const projects = join(this.configDirectory, "projects");
    try {
      const entries = await readdir(projects, { withFileTypes: true });
      return entries
        .filter((entry) => entry.isDirectory())
        .map((entry) => join(projects, entry.name));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
  }

  async #removeSubagents(session: string) {
    if (!(await lstatIfPresent(session))?.isDirectory()) return;
    try {
      await rm(join(session, "subagents"), { recursive: true, force: true });
      await rmdir(session);
    } catch (error) {
      if (!["ENOENT", "ENOTEMPTY", "EEXIST"].includes((error as NodeJS.ErrnoException).code ?? ""))
        throw error;
    }
  }
  exitSteps = exitSteps;
}
export const createClaudeSessionManager = (
  configDirectory: string,
  socket?: string,
  command?: string,
): SessionManager => new ClaudeSessionManager(configDirectory, new TmuxLauncher(socket), command);

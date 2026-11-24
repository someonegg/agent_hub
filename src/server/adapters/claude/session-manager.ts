import { lstat, readdir, rm, rmdir } from "node:fs/promises";
import { join } from "node:path";

import { TmuxLauncher } from "../../interaction/tmux-launcher.js";
import {
  SessionLaunchError,
  type SessionLaunchOptions,
  type SessionManager,
} from "../../management/session-manager.js";
import { readLaunchEnvironment } from "../shared/launch-environment.js";
import { exitSteps, resolveDirectory } from "../shared/session-management.js";
import { type ClaudeBindingIndex, validateClaudeBindingMetadata } from "./binding-index.js";
import { validClaudeId } from "./identity.js";

export class ClaudeSessionManager implements SessionManager {
  constructor(
    private readonly configDirectory: string,
    private readonly tmux: TmuxLauncher,
    private readonly index: ClaudeBindingIndex,
    private readonly command = "claude",
  ) {}
  isValidNativeId = validClaudeId;
  resolveDirectory = resolveDirectory;
  async launch(options: SessionLaunchOptions) {
    if (options.resumeNativeId !== undefined && !this.isValidNativeId(options.resumeNativeId))
      throw new Error("Invalid resume identity");
    validateClaudeBindingMetadata(options.projectDirectory ?? null, options.taskName ?? null);
    const environment = {
      ...(await readLaunchEnvironment(this.configDirectory)),
      CLAUDE_CONFIG_DIR: this.configDirectory,
    };
    let publishedPrompt: string | null = null;
    try {
      return await this.tmux.launchWithTarget(
        options.operationId,
        options.workingDirectory,
        async (target) => {
          const prompt = await this.index.publish(
            target,
            options.resumeNativeId
              ? {
                  kind: "resume",
                  operationId: options.operationId,
                  nativeId: options.resumeNativeId,
                }
              : { kind: "create", operationId: options.operationId },
            options.projectDirectory ?? null,
            options.taskName ?? null,
          );
          publishedPrompt = prompt;
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
    } catch (error) {
      if (
        publishedPrompt !== null &&
        error instanceof SessionLaunchError &&
        error.outcome === "not_started"
      ) {
        await this.index.discard(publishedPrompt).catch(() => {});
      }
      throw error;
    }
  }
  async delete(nativeId: string): Promise<void> {
    if (!this.isValidNativeId(nativeId)) throw new Error("Invalid Claude session identity");
    const projects = join(this.configDirectory, "projects");
    let entries;
    try {
      entries = await readdir(projects, { withFileTypes: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw error;
    }
    for (const project of entries) {
      if (!project.isDirectory()) continue;
      const directory = join(projects, project.name);
      const session = join(directory, nativeId);
      try {
        if ((await lstat(session)).isDirectory()) {
          await rm(join(session, "subagents"), { recursive: true, force: true });
          try {
            await rmdir(session);
          } catch (error) {
            if (
              !["ENOENT", "ENOTEMPTY", "EEXIST"].includes(
                (error as NodeJS.ErrnoException).code ?? "",
              )
            )
              throw error;
          }
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
      await rm(join(directory, `${nativeId}.jsonl`), { force: true });
    }
  }
  exitSteps = exitSteps;
}
export const createClaudeSessionManager = (
  configDirectory: string,
  index: ClaudeBindingIndex,
  socket?: string,
  command?: string,
): SessionManager =>
  new ClaudeSessionManager(configDirectory, new TmuxLauncher(socket), index, command);

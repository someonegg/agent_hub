import { execFile } from "node:child_process";
import { isAbsolute } from "node:path";
import { promisify } from "node:util";

import { SessionLaunchError } from "../management/session-manager.js";
import { tmuxTarget, validTmuxSessionName } from "./tmux-target.js";
import type { TmuxBinding } from "./transport.js";

const execute = promisify(execFile);

export function shellQuote(value: string): string {
  return "'" + value.replace(/'/g, "'\\''") + "'";
}

export function attachCommand(socket: string | undefined, session: string): string {
  return [
    "tmux",
    ...(socket ? ["-S", shellQuote(socket)] : []),
    "attach-session",
    "-t",
    shellQuote(tmuxTarget(session)),
  ].join(" ");
}

/** Launch argv without interpreting user values as shell syntax. */
export class TmuxLauncher {
  constructor(readonly socketPath?: string) {}

  async launch(
    id: string,
    directory: string,
    command: readonly string[],
    environment: Readonly<Record<string, string>> = {},
  ): Promise<TmuxBinding> {
    const sessionName = this.#validateSession(id);
    const target = await this.#createSession(
      sessionName,
      directory,
      command,
      environmentArgs(environment, sessionName),
    );
    await this.#disableRemainOnExit(target);
    return target;
  }

  async launchWithTarget(
    id: string,
    directory: string,
    prepare: (target: TmuxBinding) => Promise<readonly string[]>,
    environment: Readonly<Record<string, string>> = {},
  ): Promise<TmuxBinding> {
    const sessionName = this.#validateSession(id);
    const target = await this.#createSession(sessionName, directory, ["sleep", "60"]);
    let command: readonly string[];
    try {
      command = await prepare(target);
    } catch (error) {
      await this.#cleanup(target);
      throw error;
    }
    try {
      await execute(
        "tmux",
        [
          "-S",
          target.socketPath,
          "respawn-pane",
          "-k",
          "-t",
          tmuxTarget(sessionName),
          ...environmentArgs(environment, sessionName),
          "-c",
          directory,
          ...commandArgs(command),
        ],
        { timeout: 5_000 },
      );
    } catch (error) {
      const uncertain = isUncertainError(error);
      if (!uncertain) await this.#cleanup(target);
      throw new SessionLaunchError(
        uncertain ? "unknown" : "not_started",
        // execFile includes the command arguments (and environment values) in its error.
        "tmux respawn-pane failed",
        uncertain ? attachCommand(target.socketPath, sessionName) : null,
        uncertain ? target : undefined,
      );
    }
    await this.#disableRemainOnExit(target);
    return target;
  }

  #validateSession(id: string): string {
    const sessionName = `ahub-${id}`;
    if (!validTmuxSessionName(sessionName))
      throw new SessionLaunchError("not_started", "Invalid tmux session name", null);
    if (
      this.socketPath !== undefined &&
      (!isAbsolute(this.socketPath) || /[\0\r\n]/.test(this.socketPath))
    )
      throw new SessionLaunchError("not_started", "Invalid tmux socket path", null);
    return sessionName;
  }

  async #createSession(
    sessionName: string,
    directory: string,
    command: readonly string[],
    environmentFlags: readonly string[] = [],
  ): Promise<TmuxBinding> {
    const fallbackAttach = attachCommand(this.socketPath, sessionName);
    let stdout: string;
    try {
      ({ stdout } = await execute(
        "tmux",
        [
          ...(this.socketPath ? ["-S", this.socketPath] : []),
          "new-session",
          "-d",
          "-P",
          "-F",
          "#{socket_path}",
          "-s",
          sessionName,
          ...environmentFlags,
          "-x",
          "120",
          "-y",
          "40",
          "-c",
          directory,
          ...commandArgs(command),
        ],
        { timeout: 5_000 },
      ));
    } catch (error) {
      const uncertain = isUncertainError(error);
      throw new SessionLaunchError(
        uncertain ? "unknown" : "not_started",
        // execFile includes the command arguments (and environment values) in its error.
        "tmux new-session failed",
        uncertain ? fallbackAttach : null,
      );
    }
    const socketPath = stdout.replace(/\n$/, "");
    if (!isAbsolute(socketPath) || /[\0\r\n]/.test(socketPath)) {
      throw new SessionLaunchError("unknown", "Invalid launched tmux target", fallbackAttach);
    }
    return { socketPath, sessionName };
  }

  async #disableRemainOnExit(target: TmuxBinding): Promise<void> {
    try {
      await execute(
        "tmux",
        [
          "-S",
          target.socketPath,
          "set-option",
          "-p",
          "-t",
          tmuxTarget(target.sessionName),
          "remain-on-exit",
          "off",
        ],
        { timeout: 5_000 },
      );
    } catch (error) {
      throw new SessionLaunchError(
        "unknown",
        error instanceof Error ? error.message : String(error),
        attachCommand(target.socketPath, target.sessionName),
        target,
      );
    }
  }

  async #cleanup(target: TmuxBinding): Promise<void> {
    await execute(
      "tmux",
      ["-S", target.socketPath, "kill-session", "-t", tmuxTarget(target.sessionName)],
      { timeout: 5_000 },
    ).catch(() => {});
  }
}

function environmentArgs(
  environment: Readonly<Record<string, string>>,
  sessionName: string,
): string[] {
  return Object.entries({ ...environment, AHUB_TMUX_SESSION_NAME: sessionName }).flatMap(
    // A trailing semicolon in tmux argv separates commands unless escaped.
    ([name, value]) => ["-e", `${name}=${value.replace(/;$/, "\\;")}`],
  );
}

function commandArgs(command: readonly string[]): readonly string[] {
  // tmux treats a single command as shell text; quote the executable literally.
  return command.length === 1 ? [`exec ${shellQuote(command[0]!)}`] : command;
}

function isUncertainError(error: unknown): boolean {
  return (
    !!error &&
    typeof error === "object" &&
    (("killed" in error && Boolean(error.killed)) ||
      ("code" in error && error.code === "timeout") ||
      ("signal" in error && error.signal != null))
  );
}

import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { SessionLaunchError } from "../management/session-manager.js";
import { TmuxInteractionService } from "./tmux-service.js";
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
  readonly transport = new TmuxInteractionService();

  constructor(readonly socketPath?: string) {}

  async launch(
    id: string,
    directory: string,
    command: readonly string[],
    environment: Readonly<Record<string, string>> = {},
  ): Promise<TmuxBinding> {
    const sessionName = `ahub-${id}`;
    if (!validTmuxSessionName(sessionName))
      throw new SessionLaunchError("not_started", "Invalid tmux session name", null);
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
          ...Object.entries({ ...environment, AHUB_TMUX_SESSION_NAME: sessionName }).flatMap(
            ([name, value]) => ["-e", `${name}=${value}`],
          ),
          "-x",
          "120",
          "-y",
          "40",
          "-c",
          directory,
          // tmux treats a single command as shell text; quote the executable literally.
          ...(command.length === 1 ? [`exec ${shellQuote(command[0]!)}`] : command),
        ],
        { timeout: 5_000 },
      ));
    } catch (error) {
      const uncertain =
        !!error &&
        typeof error === "object" &&
        (("killed" in error && error.killed) ||
          ("code" in error && error.code === "timeout") ||
          ("signal" in error && error.signal != null));
      throw new SessionLaunchError(
        uncertain ? "unknown" : "not_started",
        error instanceof Error ? error.message : String(error),
        uncertain ? fallbackAttach : null,
      );
    }
    const socketPath = stdout.replace(/\n$/, "");
    if (!socketPath.startsWith("/") || socketPath.includes("\n")) {
      throw new SessionLaunchError("unknown", "Invalid launched tmux target", fallbackAttach);
    }
    const target = { socketPath, sessionName };
    try {
      await execute(
        "tmux",
        [
          "-S",
          socketPath,
          "set-option",
          "-p",
          "-t",
          tmuxTarget(sessionName),
          "remain-on-exit",
          "off",
        ],
        { timeout: 5_000 },
      );
      return target;
    } catch (error) {
      throw new SessionLaunchError(
        "unknown",
        error instanceof Error ? error.message : String(error),
        attachCommand(socketPath, sessionName),
        target,
      );
    }
  }
}

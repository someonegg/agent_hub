import { execFile } from "node:child_process";
import { mkdir, realpath } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { validOperationId } from "../../domain/operation-id.js";

const execute = promisify(execFile);
const GIT_TIMEOUT_MS = 60_000;

async function git(directory: string, args: string[]): Promise<string> {
  const { stdout } = await execute("git", ["-C", directory, ...args], { timeout: GIT_TIMEOUT_MS });
  return stdout.trim();
}

export async function createAgyWorktree(
  directory: string,
  operationId: string,
  homeDirectory = join(homedir(), ".agent-hub"),
): Promise<string> {
  if (!validOperationId(operationId)) throw new Error("Invalid worktree operation ID");

  if ((await git(directory, ["rev-parse", "--is-inside-work-tree"]).catch(() => "")) !== "true")
    throw new Error("Agy worktree requires a working directory inside a Git repository");
  const head = await git(directory, ["rev-parse", "--verify", "HEAD^{commit}"]).catch(() => {
    throw new Error("Agy worktree requires a Git repository with a committed HEAD");
  });

  const root = join(homeDirectory, "worktrees");
  await mkdir(root, { recursive: true });
  const path = join(await realpath(root), operationId);
  await git(directory, ["worktree", "add", "--detach", path, head]);
  return path;
}

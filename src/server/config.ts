import { realpathSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import { NODE_ID_PATTERN } from "../shared/node-id.js";

const NODE_ID = new RegExp(`^${NODE_ID_PATTERN}$`);

export function resolveHomeDirectory(value?: string): string {
  return value === undefined
    ? resolve(homedir(), ".agent-hub")
    : resolvePathOption("home-dir", value);
}

export const LOOPBACK_HOST = "127.0.0.1" as const;

export type ServerTlsConfig =
  | { readonly enabled: false }
  | {
      readonly enabled: true;
      readonly certificatePath: string;
      readonly privateKeyPath: string;
      readonly certificateAuthorityPath?: string;
    };

export interface AgentConfig {
  nickname: string;
  path: string;
  adapter?: "codex" | "claude" | "agy";
  command?: string;
}

export interface NodeTarget {
  id: string;
  url: URL;
}

export type ServerMode =
  | { kind: "node" }
  | { kind: "hub"; nodes: NodeTarget[]; clientIdentity?: { cert: string; key: string } };

export interface ServerConfig {
  mode?: ServerMode;
  agents: AgentConfig[];
  host: string;
  port: number;
  localPort?: number;
  localHost?: string;
  clientDirectory: string;
  tls: ServerTlsConfig;
  interactionEnabled: boolean;
  tmuxSocket?: string;
  uploadDirectory?: string;
  hostingDirectory?: string;
}

export type CommandLineResult =
  | { readonly kind: "help" }
  | { readonly kind: "version" }
  | { readonly kind: "run"; readonly config: ServerConfig };

function nonEmptyOption(name: string, value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const normalized = value.trim();
  if (normalized.length === 0) {
    throw new Error(`--${name} must not be empty`);
  }
  return normalized;
}

function parsePort(value: string | undefined, option = "port"): number {
  if (value === undefined) return 4173;
  const port = Number(value);
  if (!Number.isInteger(port) || port < 0 || port > 65_535) {
    throw new Error(`--${option} must be an integer between 0 and 65535`);
  }
  return port;
}

export function loadConfig(args: readonly string[] = process.argv.slice(2)): CommandLineResult {
  const { values, tokens } = parseArgs({
    tokens: true,
    args: [...args],
    allowPositionals: false,
    strict: true,
    options: {
      "agent-command": { type: "string", multiple: true },
      "codex-agent": { type: "string", multiple: true },
      "claude-agent": { type: "string", multiple: true },
      "agy-agent": { type: "string", multiple: true },
      host: { type: "string" },
      port: { type: "string" },
      "local-port": { type: "string" },
      "local-host": { type: "string" },
      ssl: { type: "boolean" },
      "ssl-cert": { type: "string" },
      "ssl-key": { type: "string" },
      "ssl-ca": { type: "string" },
      help: { type: "boolean" },
      version: { type: "boolean" },
      "tmux-socket": { type: "string" },
      "home-dir": { type: "string" },
      hosting: { type: "boolean" },
      node: { type: "string", multiple: true },
      "node-only": { type: "boolean" },
      "node-client-cert": { type: "string" },
      "node-client-key": { type: "string" },
    },
  });

  if (values.help) return { kind: "help" };
  if (values.version) return { kind: "version" };

  const host = nonEmptyOption("host", values.host) ?? LOOPBACK_HOST;
  const nodes = parseNodes(values.node ?? []);
  if (nodes.length && values["node-only"])
    throw new Error("--node and --node-only are mutually exclusive");
  const cert = nonEmptyOption("node-client-cert", values["node-client-cert"]);
  const key = nonEmptyOption("node-client-key", values["node-client-key"]);
  if (Boolean(cert) !== Boolean(key) || ((cert || key) && !nodes.length)) {
    throw new Error(
      "--node-client-cert and --node-client-key must be provided together with --node",
    );
  }
  const mode: ServerMode | undefined = nodes.length
    ? {
        kind: "hub",
        nodes,
        ...(cert && key
          ? {
              clientIdentity: {
                cert: resolvePathOption("node-client-cert", cert),
                key: resolvePathOption("node-client-key", key),
              },
            }
          : {}),
      }
    : values["node-only"]
      ? { kind: "node" }
      : undefined;
  const agents =
    mode?.kind === "hub"
      ? []
      : parseAgents(
          tokens.flatMap((token) =>
            token.kind === "option" &&
            (token.name === "codex-agent" ||
              token.name === "claude-agent" ||
              token.name === "agy-agent")
              ? [{ option: token.name, value: token.value! }]
              : [],
          ),
          values["agent-command"] ?? [],
        );
  const certificatePath = nonEmptyOption("ssl-cert", values["ssl-cert"]);
  const privateKeyPath = nonEmptyOption("ssl-key", values["ssl-key"]);
  const certificateAuthorityPath = nonEmptyOption("ssl-ca", values["ssl-ca"]);

  let tls: ServerTlsConfig;
  if (values.ssl) {
    if (!certificatePath || !privateKeyPath) {
      throw new Error("--ssl requires both --ssl-cert and --ssl-key");
    }
    tls = {
      enabled: true,
      certificatePath: resolvePathOption("ssl-cert", certificatePath),
      privateKeyPath: resolvePathOption("ssl-key", privateKeyPath),
      ...(certificateAuthorityPath
        ? { certificateAuthorityPath: resolvePathOption("ssl-ca", certificateAuthorityPath) }
        : {}),
    };
  } else {
    if (certificatePath || privateKeyPath || certificateAuthorityPath) {
      throw new Error("--ssl-cert, --ssl-key, and --ssl-ca require --ssl");
    }
    tls = { enabled: false };
  }

  const homeDirectory = resolveHomeDirectory(values["home-dir"]);

  return {
    kind: "run",
    config: {
      ...(mode ? { mode } : {}),
      host,
      localHost: nonEmptyOption("local-host", values["local-host"]) ?? LOOPBACK_HOST,
      port: parsePort(values.port),
      ...(values["local-port"] !== undefined
        ? { localPort: parsePort(values["local-port"], "local-port") }
        : {}),
      agents,
      clientDirectory: fileURLToPath(new URL("../../client/", import.meta.url)),
      tls,
      interactionEnabled: true,
      ...(mode?.kind !== "hub" ? { uploadDirectory: resolve(homeDirectory, "uploads") } : {}),
      ...(values.hosting && mode?.kind !== "hub"
        ? { hostingDirectory: resolve(homeDirectory, "hosting") }
        : {}),
      ...(values["tmux-socket"] !== undefined
        ? { tmuxSocket: resolvePathOption("tmux-socket", values["tmux-socket"]) }
        : {}),
    },
  };
}

function parseNodes(values: readonly string[]): NodeTarget[] {
  const ids = new Set<string>();
  return values.map((value) => {
    const separator = value.indexOf("=");
    const id = value.slice(0, separator);
    const address = value.slice(separator + 1);
    if (separator < 0 || !NODE_ID.test(id)) {
      throw new Error(
        "--node requires id=http(s)://host with an ID containing only ASCII letters, digits, or hyphens",
      );
    }
    const url = URL.parse(address);
    if (!url || !/^https?:\/\/[^/@?#\s\\]+\/?$/i.test(address)) {
      throw new Error(`Invalid upstream address for node ${id}; expected an HTTP(S) origin`);
    }
    if (ids.has(id)) throw new Error(`Duplicate node ID: ${id}`);
    ids.add(id);
    return { id, url };
  });
}

type AgentOption = "codex-agent" | "claude-agent" | "agy-agent";
const AGY_DEFAULT_PATH = "~/.gemini/antigravity-cli";

function parseAgents(
  explicit: { option: AgentOption; value: string }[],
  commands: string[],
): AgentConfig[] {
  const names = new Set<string>();
  const paths = new Set<string>();
  let entries = explicit;
  if (entries.filter(({ option }) => option === "agy-agent").length > 1) {
    throw new Error("Only one --agy-agent is supported");
  }
  if (entries.length === 0) {
    entries = [
      { option: "codex-agent", value: "codex=~/.codex" },
      { option: "claude-agent", value: "claude=~/.claude" },
    ];
    try {
      statSync(resolve(homedir(), ".codex"));
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ENOENT") entries.reverse();
      else if (code !== "EACCES" && code !== "EPERM") throw error;
    }
    try {
      if (statSync(resolvePathOption("agy-agent", AGY_DEFAULT_PATH)).isDirectory()) {
        entries.push({ option: "agy-agent", value: "agy" });
      }
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "ENOENT" && code !== "ENOTDIR" && code !== "EACCES" && code !== "EPERM")
        throw error;
    }
  }
  const agents: AgentConfig[] = entries.map(({ option, value }) => {
    if (option === "agy-agent") {
      if (value.includes("=") || !value.trim()) {
        throw new Error("--agy-agent requires a non-empty nickname only");
      }
      return {
        ...parseAgent(`${value}=${AGY_DEFAULT_PATH}`, option, names, paths),
        adapter: "agy",
      };
    }
    return {
      ...parseAgent(value, option, names, paths),
      ...(option === "claude-agent" ? { adapter: "claude" as const } : {}),
    };
  });
  for (const value of commands) {
    const separator = value.indexOf("=");
    const nickname = value.slice(0, separator).trim();
    const executable = value.slice(separator + 1).trim();
    if (separator < 0 || !nickname || !executable) {
      throw new Error("--agent-command requires nickname=executable with non-empty fields");
    }
    const agent = agents.find((agent) => agent.nickname === nickname);
    if (!agent) throw new Error(`Unknown agent nickname for --agent-command: ${nickname}`);
    if (agent.command !== undefined) throw new Error(`Duplicate agent command: ${nickname}`);
    agent.command = executable.includes("/")
      ? resolvePathOption("agent-command", executable)
      : executable;
  }
  return agents;
}

export function commandLineHelp(): string {
  return `Usage: agent-hub [options]

Options:
  --node-only          Run a standalone Node without the Web UI
  --node <id=url>     Run a multi-node Hub; repeat for multiple Nodes
  --node-client-cert <path>
                       PEM client certificate for HTTPS Nodes
  --node-client-key <path>
                       PEM client key for HTTPS Nodes
  --hosting            Enable trusted same-origin static web hosting
  --home-dir <path>    Hub data root (default: ~/.agent-hub; uploads/ and hosting/)
  --codex-agent <nickname=path>
                       Codex agent; repeat for multiple agents
  --claude-agent <nickname=path>
                       Claude Code agent; repeat for multiple agents
  --agy-agent <nickname>
                       Antigravity CLI agent at ~/.gemini/antigravity-cli (at most one)
  --agent-command <nickname=executable>
                       Override an agent executable; repeat for multiple agents.
                       Filename uses PATH; paths resolve from the Hub working directory.
                       No shell parsing; use a wrapper script for fixed arguments.
  Default agents: codex=~/.codex, claude=~/.claude (Claude first if ~/.codex is absent),
  plus agy=~/.gemini/antigravity-cli when that directory exists.
  Any explicit agent replaces the defaults; argument order determines the default agent.
  --host <host>        Listen host (default: 127.0.0.1)
  --port <port>        Listen port, or 0 for a free port (default: 4173)
  --local-port <port>  Additional HTTP listener (disabled by default)
  --local-host <host>  Additional HTTP listen host (default: 127.0.0.1)
  --ssl                Enable TLS; the port will accept HTTPS only
  --ssl-cert <path>    PEM server certificate or certificate chain
  --ssl-key <path>     PEM server private key
  --ssl-ca <path>      PEM CA bundle; enables mandatory client certificates
  --tmux-socket <path> tmux socket (default: tmux default selection)
  --help               Show this help
  --version            Show the current version

TLS example:
  agent-hub --ssl --ssl-cert server.crt --ssl-key server.key

mTLS example:
  agent-hub --ssl --ssl-cert server.crt --ssl-key server.key --ssl-ca ca.crt`;
}

function parseAgent(
  value: string,
  option: string,
  names: Set<string>,
  paths: Set<string>,
): AgentConfig {
  const separator = value.indexOf("=");
  const nickname = value.slice(0, separator).trim();
  const agentPath = value.slice(separator + 1).trim();
  if (separator < 0 || !nickname || !agentPath) {
    throw new Error(`--${option} requires nickname=path with a non-empty nickname and path`);
  }
  const path = resolvePathOption(option, agentPath);
  let canonical = path;
  try {
    canonical = realpathSync(path);
  } catch (error) {
    if (
      !(
        error &&
        typeof error === "object" &&
        "code" in error &&
        ["ENOENT", "EACCES", "EPERM"].includes(String(error.code))
      )
    )
      throw error;
  }
  if (names.has(nickname)) throw new Error(`Duplicate agent nickname: ${nickname}`);
  if (paths.has(canonical)) throw new Error("Duplicate agent path");
  names.add(nickname);
  paths.add(canonical);
  return { nickname, path };
}

export function resolvePathOption(name: string, value: string): string {
  const path = nonEmptyOption(name, value)!;
  return resolve(path.startsWith("~/") ? resolve(homedir(), path.slice(2)) : path);
}

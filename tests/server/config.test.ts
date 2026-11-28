import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { loadConfig } from "../../src/server/config.js";

function runnable(args: readonly string[]) {
  const result = loadConfig(args);
  if (result.kind !== "run") throw new Error("Expected runnable configuration");
  return result.config;
}

describe("server command line", () => {
  it("returns version without resolving server configuration", () => {
    expect(loadConfig(["--version", "--ssl"])).toEqual({ kind: "version" });
  });

  it("uses local, non-TLS defaults", () => {
    expect(runnable([])).toMatchObject({
      host: "127.0.0.1",
      port: 4173,
      localHost: "127.0.0.1",
      agents: [
        ...(existsSync(resolve(homedir(), ".codex"))
          ? ["codex", "claude"]
          : ["claude", "codex"]
        ).map((nickname) => ({ nickname, path: resolve(homedir(), `.${nickname}`) })),
        ...(existsSync(resolve(homedir(), ".gemini/antigravity-cli"))
          ? [{ nickname: "agy", path: resolve(homedir(), ".gemini/antigravity-cli") }]
          : []),
      ],
      tls: { enabled: false },
      interactionEnabled: true,
      trustWorkspaceForSession: false,
      uploadDirectory: resolve(homedir(), ".agent-hub/uploads"),
    });
  });

  it("opts local launches into session workspace trust", () => {
    expect(runnable(["--trust-workspace-for-session"]).trustWorkspaceForSession).toBe(true);
  });

  it("parses all server and mutual TLS options", () => {
    expect(
      runnable([
        "--codex-agent",
        "personal=fixtures/codex",
        "--host",
        "0.0.0.0",
        "--port",
        "0",
        "--local-host",
        " 0.0.0.0 ",
        "--local-port",
        "4174",
        "--ssl",
        "--ssl-cert",
        "certs/server.pem",
        "--ssl-key",
        "certs/server-key.pem",
        "--ssl-ca",
        "certs/ca.pem",
      ]),
    ).toMatchObject({
      host: "0.0.0.0",
      port: 0,
      localHost: "0.0.0.0",
      localPort: 4174,
      agents: [{ nickname: "personal", path: resolve("fixtures/codex") }],
      tls: {
        enabled: true,
        certificatePath: resolve("certs/server.pem"),
        privateKeyPath: resolve("certs/server-key.pem"),
        certificateAuthorityPath: resolve("certs/ca.pem"),
      },
    });
  });

  it("rejects incomplete and unused TLS options", () => {
    expect(() => loadConfig(["--ssl"])).toThrow("--ssl requires both --ssl-cert and --ssl-key");
    expect(() => loadConfig(["--ssl-cert", "server.pem"])).toThrow("require --ssl");
    expect(() => loadConfig(["--ssl-ca", "ca.pem"])).toThrow("require --ssl");
  });

  it("rejects malformed general options", () => {
    expect(() => loadConfig(["--port", "65536"])).toThrow("--port must be an integer");
    expect(() => loadConfig(["--unknown"])).toThrow();
    expect(() => loadConfig(["--local-host", " "])).toThrow("--local-host must not be empty");
    expect(() => loadConfig(["--tmux-socket", " "])).toThrow("--tmux-socket must not be empty");
    expect(() => loadConfig(["positional"])).toThrow();
  });
});

it("resolves upload directories and rejects empty configuration", () => {
  const config = runnable(["--home-dir", "uploads with spaces"]);
  expect(config.homeDirectory).toBe(resolve("uploads with spaces"));
  expect(config.uploadDirectory).toBe(resolve("uploads with spaces", "uploads"));
  expect(() => loadConfig(["--home-dir", " "])).toThrow("--home-dir must not be empty");
});

it("shares the Hub root for uploads and hosting, expanding agent-relative paths", () => {
  expect(runnable(["--hosting"])).toMatchObject({
    uploadDirectory: resolve(homedir(), ".agent-hub/uploads"),
    hostingDirectory: resolve(homedir(), ".agent-hub/hosting"),
  });
  expect(runnable(["--hosting", "--home-dir", "~/hub-data"])).toMatchObject({
    uploadDirectory: resolve(homedir(), "hub-data/uploads"),
    hostingDirectory: resolve(homedir(), "hub-data/hosting"),
  });
});

it("names local-port in integer and range validation errors", () => {
  for (const value of ["65536", "1.5"]) {
    expect(() => loadConfig([`--local-port=${value}`]), JSON.stringify(value)).toThrow(
      "--local-port must be an integer between 0 and 65535",
    );
  }
});

it("resolves all server path options consistently for home, relative and absolute paths", () => {
  for (const path of ["~/config with spaces", "./config with spaces", "/tmp/config with spaces"]) {
    const expected = path.startsWith("~/") ? resolve(homedir(), path.slice(2)) : resolve(path);
    const config = runnable([
      "--codex-agent",
      `codex=${path}/codex`,
      "--claude-agent",
      `claude=${path}/claude`,
      "--home-dir",
      path,
      "--hosting",
      "--tmux-socket",
      path,
      "--ssl",
      "--ssl-cert",
      path,
      "--ssl-key",
      path,
      "--ssl-ca",
      path,
    ]);
    expect(config, JSON.stringify(path)).toMatchObject({
      agents: [
        { nickname: "codex", path: resolve(expected, "codex") },
        { nickname: "claude", path: resolve(expected, "claude") },
      ],
      uploadDirectory: resolve(expected, "uploads"),
      hostingDirectory: resolve(expected, "hosting"),
      tmuxSocket: expected,
      tls: {
        enabled: true,
        certificatePath: expected,
        privateKeyPath: expected,
        certificateAuthorityPath: expected,
      },
    });
  }
});

it("configures a single agy agent at its fixed data path", () => {
  expect(runnable(["--agy-agent", "agy"])).toMatchObject({
    agents: [
      { nickname: "agy", adapter: "agy", path: resolve(homedir(), ".gemini/antigravity-cli") },
    ],
  });
  expect(runnable(["--agy-agent", "ag", "--codex-agent", "c=/tmp/c"])).toMatchObject({
    agents: [
      { nickname: "ag", adapter: "agy", path: resolve(homedir(), ".gemini/antigravity-cli") },
      { nickname: "c" },
    ],
  });
  expect(() => loadConfig(["--agy-agent", "ag=/tmp/agy-data"])).toThrow(
    "--agy-agent requires a non-empty nickname only",
  );
  expect(() => loadConfig(["--agy-agent", "   "])).toThrow(
    "--agy-agent requires a non-empty nickname only",
  );
  expect(() => loadConfig(["--agy-agent", "a", "--agy-agent", "b"])).toThrow(
    "Only one --agy-agent is supported",
  );
});

#!/usr/bin/env node

import { commandLineHelp, loadConfig } from "./config.js";
import { startServer } from "./http/create-server.js";
import { createNodeProxy } from "./http/node-proxy.js";
import { startNode } from "./node.js";
import { packageVersion } from "./version.js";

async function main(): Promise<void> {
  const command = loadConfig();
  if (command.kind === "help") {
    console.log(commandLineHelp());
    return;
  }

  if (command.kind === "version") {
    console.log(await packageVersion());
    return;
  }

  const { config } = command;
  const proxy = config.mode?.kind === "hub" ? createNodeProxy(config.mode) : undefined;
  const server = proxy
    ? await startServer(config, proxy.route, () => {}, proxy, {
        diffPageStatus: proxy.diffPageStatus,
      })
    : await startNode(config);
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : config.port;
  const host = config.host.includes(":") ? `[${config.host}]` : config.host;
  const protocol = config.tls.enabled ? "https" : "http";
  const mutualTls =
    config.tls.enabled && config.tls.certificateAuthorityPath
      ? " (client certificates required)"
      : "";
  console.log(`Agent Hub listening on ${protocol}://${host}:${port}${mutualTls}`);

  function close(): void {
    server.close((error) => {
      if (error) {
        console.error("Failed to stop Agent Hub");
        process.exitCode = 1;
      }
    });
  }

  process.once("SIGINT", close);
  process.once("SIGTERM", close);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Failed to start Agent Hub");
  process.exitCode = 1;
});

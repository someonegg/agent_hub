import { createReadStream, readFileSync, realpathSync } from "node:fs";
import { readFile, realpath, stat } from "node:fs/promises";
import {
  createServer as createHttpServer,
  type RequestListener,
  type ServerResponse,
} from "node:http";
import { createServer as createHttpsServer } from "node:https";
import type { Server as NetServer } from "node:net";
import { extname, resolve, sep } from "node:path";
import { pipeline } from "node:stream";

import { NODE_ID_PATTERN } from "../../shared/node-id.js";
import { LOOPBACK_HOST, type ServerConfig } from "../config.js";
import { DiffStore } from "../hosting/diff-store.js";
import { hostingRoutes } from "../hosting/routes.js";
import type { ApiRouterOptions } from "./api-router.js";
import {
  decodePath,
  isMissingFile,
  MalformedRequestError,
  reportRequestError,
  requestUrl,
} from "./request-errors.js";
import { type ApiRouter, emptyApiRouter, sendJson } from "./router.js";
import { applySecurityHeaders } from "./security.js";
import type { ServerUpgradeHandler } from "./terminal-preview-websocket.js";

const NODE_PAGE_PATH = new RegExp(`^/nodes/(${NODE_ID_PATTERN})(/.*)?$`);

const CONTENT_TYPES: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/vnd.microsoft.icon",
  ".webmanifest": "application/manifest+json; charset=utf-8",
};

type ServerOptions = ApiRouterOptions & {
  diffPageStatus?: (nodeId: string, diffId: string, signal: AbortSignal) => Promise<number>;
};

function sendText(
  response: ServerResponse,
  status: number,
  message: string,
  headOnly: boolean,
  contentType = "text/plain; charset=utf-8",
): void {
  response.statusCode = status;
  response.setHeader("Content-Type", contentType);
  response.setHeader("Content-Length", Buffer.byteLength(message));
  response.end(headOnly ? undefined : message);
}

async function serveFile(
  response: ServerResponse,
  filePath: string,
  headOnly: boolean,
  status = 200,
  onStreamError: (error: unknown) => void = () => {},
): Promise<boolean> {
  try {
    const info = await stat(filePath);
    if (!info.isFile()) return false;
    response.statusCode = status;
    response.setHeader(
      "Content-Type",
      CONTENT_TYPES[extname(filePath)] ?? "application/octet-stream",
    );
    response.setHeader("Content-Length", info.size);
    if (headOnly) {
      response.end();
    } else if (!response.destroyed) {
      pipeline(createReadStream(filePath), response, (error) => {
        if (error && (error as NodeJS.ErrnoException).code !== "ERR_STREAM_PREMATURE_CLOSE")
          onStreamError(error);
      });
    }
    return true;
  } catch (error) {
    if (!isMissingFile(error)) throw error;
    return false;
  }
}

export function createServer(
  config: ServerConfig,
  apiRouter: ApiRouter = emptyApiRouter,
  closeServices: () => void = () => {},
  upgrades?: ServerUpgradeHandler,
  options: ServerOptions = {},
) {
  const standalone = config.mode?.kind === "node";
  const hub = config.mode?.kind === "hub" ? config.mode : undefined;
  const clientRoot = standalone ? "" : realpathSync(config.clientDirectory);
  const hosting = hostingRoutes(config.hostingDirectory, options);
  const diffs = config.hostingDirectory ? new DiffStore(config.hostingDirectory) : undefined;
  const clientRootPrefix = `${clientRoot}${sep}`;
  const requestListener: RequestListener = async (request, response) => {
    applySecurityHeaders(response, request);
    const headOnly = request.method === "HEAD";

    try {
      if (!hub && (await hosting(request, response))) return;
      if (await apiRouter(request, response)) return;
      if (standalone) {
        sendText(response, 404, "Not found", headOnly);
        return;
      }
      if (request.method !== "GET" && !headOnly) {
        response.setHeader("Allow", "GET, HEAD");
        sendJson(response, 405, {
          error: { code: "method_not_allowed", message: "Method is not allowed for this resource" },
        });
        return;
      }
      const url = requestUrl(request);
      const nodePage = hub && NODE_PAGE_PATH.exec(url.pathname);
      if (nodePage && !hub.nodes.some(({ id }) => id === nodePage[1])) {
        sendText(response, 404, "Not found", headOnly);
        return;
      }
      const decodedPath = decodePath(nodePage ? (nodePage[2] ?? "/") : url.pathname);
      const sessionPage = /^\/sessions\/[A-Za-z0-9_-]{20,100}(?:\/uploads)?\/?$/.test(decodedPath);
      const diffPage = /^\/diffs\/([a-f0-9-]{36})$/.exec(decodedPath);
      const appPage = hub
        ? url.pathname === "/" ||
          (!nodePage && decodedPath === "/index.html") ||
          (nodePage &&
            (decodedPath === "/" || sessionPage || decodedPath === "/artifacts" || diffPage))
        : decodedPath === "/" ||
          sessionPage ||
          ((decodedPath === "/artifacts" || diffPage) && config.hostingDirectory);
      if (diffPage) response.setHeader("Cache-Control", "private, no-store");
      const relativePath = appPage
        ? "index.html"
        : (nodePage ? decodePath(url.pathname) : decodedPath).slice(1);
      const requestedPath = resolve(clientRoot, relativePath);
      let canonicalPath: string;
      try {
        canonicalPath = await realpath(requestedPath);
      } catch (error) {
        if (!isMissingFile(error)) throw error;
        sendText(response, 404, "Not found", headOnly);
        return;
      }

      if (hub && appPage && canonicalPath.startsWith(clientRootPrefix)) {
        const index = await readFile(canonicalPath, "utf8");
        if (response.destroyed) return;
        let status = 200;
        if (nodePage && diffPage) {
          const controller = new AbortController();
          const abort = () => controller.abort();
          response.once("close", abort);
          try {
            status =
              (await options.diffPageStatus?.(nodePage[1], diffPage[1], controller.signal)) ?? 502;
          } finally {
            response.off("close", abort);
          }
        }
        if (response.destroyed) return;
        sendText(
          response,
          status,
          index.replace("</head>", '<meta name="ahub-multi-node"></head>'),
          headOnly,
          "text/html; charset=utf-8",
        );
        return;
      }
      const pageStatus = diffPage && diffs && !(await diffs.exists(diffPage[1])) ? 404 : 200;
      if (
        canonicalPath.startsWith(clientRootPrefix) &&
        (await serveFile(response, canonicalPath, headOnly, pageStatus, (error) =>
          reportRequestError(request, response, error, options),
        ))
      ) {
        return;
      }
      sendText(response, 404, "Not found", headOnly);
    } catch (error) {
      if (!(error instanceof MalformedRequestError) || response.headersSent) {
        reportRequestError(request, response, error, options);
        return;
      }
      sendJson(
        response,
        400,
        { error: { code: "bad_request", message: "Malformed request" } },
        headOnly,
      );
    }
  };

  if (!config.tls.enabled) {
    const server = createHttpServer(requestListener);
    return attachLifecycle(server, closeServices, upgrades);
  }

  const requireClientCertificate = config.tls.certificateAuthorityPath !== undefined;
  const server = createHttpsServer(
    {
      cert: readFileSync(config.tls.certificatePath),
      key: readFileSync(config.tls.privateKeyPath),
      ...(config.tls.certificateAuthorityPath
        ? { ca: readFileSync(config.tls.certificateAuthorityPath) }
        : {}),
      minVersion: "TLSv1.2",
      requestCert: requireClientCertificate,
      rejectUnauthorized: requireClientCertificate,
    },
    requestListener,
  );
  return attachLifecycle(server, closeServices, upgrades);
}

/** Own startup cleanup as well as the server's pre-drain shutdown hook. */
export async function startServer(
  config: ServerConfig,
  apiRouter: ApiRouter,
  closeServices: () => void,
  upgrades?: ServerUpgradeHandler,
  options: ServerOptions = {},
) {
  let primary: ReturnType<typeof createServer> | undefined;
  let local: ReturnType<typeof createServer> | undefined;
  let cleaned = false;
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    upgrades?.close();
    closeServices();
  };
  // Listener shutdown must leave shared WebSocket cleanup to the owner above.
  const listenerUpgrades = upgrades && {
    handle: upgrades.handle.bind(upgrades),
    close: () => {},
  };
  try {
    primary = createServer(config, apiRouter, () => {}, listenerUpgrades, options);
    await listenServer(primary, config.port, config.host);
    if (config.localPort !== undefined) {
      local = createServer(
        { ...config, tls: { enabled: false } },
        apiRouter,
        () => {},
        listenerUpgrades,
        options,
      );
      const localHost = config.localHost ?? LOOPBACK_HOST;
      await listenServer(local, config.localPort, localHost);
      const address = local.address();
      if (address && typeof address === "object") {
        const urlHost = localHost.includes(":") ? `[${localHost}]` : localHost;
        console.log(`Agent Hub local HTTP listening on http://${urlHost}:${address.port}`);
      }
    }
    const server = primary;
    const close = server.close.bind(server);
    server.close = ((callback?: (error?: Error) => void) => {
      let pending = local ? 2 : 1;
      let failure: Error | undefined;
      const finished = (error?: Error) => {
        failure ??= error;
        if (--pending === 0) callback?.(failure);
      };
      cleanup();
      close(finished);
      local?.close(finished);
      return server;
    }) as typeof server.close;
    return server;
  } catch (error) {
    cleanup();
    for (const server of [local, primary]) {
      if (server?.listening) {
        server.close();
        server.closeAllConnections();
      }
    }
    throw error;
  }
}

export function listenServer(server: NetServer, port: number, host: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      server.removeListener("error", onError);
      server.removeListener("listening", onListening);
    };
    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };
    const onListening = () => {
      cleanup();
      resolve();
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(port, host);
  });
}

function attachLifecycle<T extends ReturnType<typeof createHttpServer>>(
  server: T,
  closeServices: () => void,
  upgrades?: ServerUpgradeHandler,
): T {
  server.on("upgrade", (request, socket, head) => {
    if (upgrades) upgrades.handle(request, socket, head);
    else socket.destroy();
  });
  const close = server.close.bind(server);
  const mutable = server as unknown as {
    close(callback?: (error?: Error) => void): T;
  };
  mutable.close = (callback?: (error?: Error) => void) => {
    upgrades?.close();
    closeServices();
    close(callback);
    return server;
  };
  return server;
}

import { readFileSync } from "node:fs";
import {
  Agent as HttpAgent,
  type IncomingMessage,
  type OutgoingHttpHeaders,
  request as httpRequest,
  STATUS_CODES,
} from "node:http";
import { Agent as HttpsAgent, request as httpsRequest } from "node:https";
import type { Duplex } from "node:stream";

import { NODE_ID_PATTERN } from "../../shared/node-id.js";
import type { NodeTarget, ServerMode } from "../config.js";
import { MalformedRequestError, requestUrl } from "./request-errors.js";
import { type ApiRouter, emptyApiRouter, sendJson } from "./router.js";
import { SESSION_ID_PATTERN, SESSION_ROOT } from "./session-path.js";
import type { ServerUpgradeHandler } from "./terminal-preview-websocket.js";

const API_PATH = new RegExp(`^/api/nodes/(${NODE_ID_PATTERN})(/v1(?:/.*)?)$`);
const WEB_PATH = new RegExp(`^/nodes/(${NODE_ID_PATTERN})(/web(?:/.*)?)$`);
const TERMINAL_PATH = new RegExp(`^${SESSION_ROOT}/${SESSION_ID_PATTERN}/terminal-preview$`);
const HOP_HEADERS = [
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
  "proxy-connection",
];

function endToEnd(headers: IncomingMessage["headers"]): OutgoingHttpHeaders {
  const result = { ...headers };
  for (const name of [...HOP_HEADERS, ...(headers.connection ?? "").toLowerCase().split(",")])
    delete result[name.trim()];
  return result;
}

function sameOrigin(request: IncomingMessage) {
  const scheme = "encrypted" in request.socket && request.socket.encrypted ? "https" : "http";
  return (
    request.headers.origin === undefined ||
    request.headers.origin === `${scheme}://${request.headers.host}`
  );
}

export function createNodeProxy(
  config: Extract<ServerMode, { kind: "hub" }>,
  timeoutMs = 35_000,
): ServerUpgradeHandler & {
  route: ApiRouter;
  diffPageStatus: (nodeId: string, diffId: string, signal: AbortSignal) => Promise<number>;
} {
  const nodes = new Map(config.nodes.map((node) => [node.id, node]));
  const identity = config.clientIdentity && {
    cert: readFileSync(config.clientIdentity.cert),
    key: readFileSync(config.clientIdentity.key),
  };
  const active = new Set<() => void>();
  const httpAgent = new HttpAgent({ keepAlive: true });
  const httpsAgent = new HttpsAgent({ keepAlive: true });

  function requestNode(
    node: NodeTarget,
    path: string,
    method: string | undefined,
    headers: OutgoingHttpHeaders,
  ) {
    const secure = node.url.protocol === "https:";
    return (secure ? httpsRequest : httpRequest)(node.url, {
      method,
      path,
      headers,
      agent: secure ? httpsAgent : httpAgent,
      ...(secure ? { ...identity, rejectUnauthorized: true } : {}),
    });
  }

  function connect(request: IncomingMessage, node: NodeTarget, path: string, upgrade = false) {
    const headers = endToEnd(request.headers);
    headers.host = node.url.host;
    delete headers.origin;
    if (upgrade) {
      headers.connection = "Upgrade";
      headers.upgrade = "websocket";
    } else if (
      !headers["content-length"] &&
      (request.headers["transfer-encoding"] || request.headers["content-length"])
    ) {
      headers["transfer-encoding"] = "chunked";
    }
    return requestNode(node, path, request.method, headers);
  }

  return {
    async diffPageStatus(nodeId, diffId, signal) {
      const node = nodes.get(nodeId);
      if (!node) return 404;
      if (signal.aborted) return 502;
      return new Promise<number>((resolve) => {
        const upstream = requestNode(
          node,
          `/api/v1/diffs/${encodeURIComponent(diffId)}`,
          "HEAD",
          {},
        );
        const abort = () => {
          finish(502);
          upstream.destroy();
        };
        const finish = (status: number) => {
          clearTimeout(timer);
          active.delete(abort);
          signal.removeEventListener("abort", abort);
          resolve(status);
        };
        const timer = setTimeout(() => {
          finish(504);
          upstream.destroy();
        }, timeoutMs);
        active.add(abort);
        signal.addEventListener("abort", abort, { once: true });
        upstream.once("error", () => finish(502));
        upstream.once("response", (incoming) => {
          incoming.resume();
          const status = incoming.statusCode;
          finish(status === 200 || status === 404 ? status : 502);
        });
        upstream.end();
      });
    },
    route(request, response) {
      const url = requestUrl(request);
      const { pathname, search } = url;
      const head = request.method === "HEAD";
      const fail = (status: number, code: string, message: string) =>
        sendJson(response, status, { error: { code, message } }, head);
      if (pathname === "/api/nodes" && request.method === "GET") {
        sendJson(response, 200, { nodes: config.nodes.map(({ id }) => ({ id })) });
        return true;
      }
      const api = API_PATH.exec(pathname);
      const web = WEB_PATH.exec(pathname);
      const match = api ?? web;
      if (!match) return emptyApiRouter(request, response);
      const node = nodes.get(match[1]);
      if (!node) {
        fail(404, "not_found", "Node not found");
        return true;
      }
      if (request.method !== "GET" && !head && !sameOrigin(request)) {
        fail(403, "forbidden", "Cross-origin Node requests are not allowed");
        return true;
      }
      const upstream = connect(request, node, (api ? "/api" : "") + match[2] + search);
      const abort = () => {
        upstream.destroy();
        response.destroy();
      };
      active.add(abort);
      let timedOut = false;
      const timeout = () => {
        timedOut = true;
        upstream.destroy(new Error("Upstream timed out"));
      };
      let uploadTimer: ReturnType<typeof setTimeout>;
      let headerTimer: ReturnType<typeof setTimeout> | undefined;
      let receivedResponse = false;
      const refreshUploadTimer = () => {
        clearTimeout(uploadTimer);
        uploadTimer = setTimeout(timeout, timeoutMs);
      };
      const stopUploadTimer = () => {
        request.off("data", refreshUploadTimer);
        clearTimeout(uploadTimer);
      };
      refreshUploadTimer();
      upstream.once("finish", () => {
        stopUploadTimer();
        if (!receivedResponse && !upstream.destroyed) headerTimer = setTimeout(timeout, timeoutMs);
      });
      const cleanup = () => {
        stopUploadTimer();
        clearTimeout(headerTimer);
        active.delete(abort);
        if (!response.writableFinished || !upstream.writableFinished) upstream.destroy();
      };
      response.once("close", cleanup);
      upstream.on("error", () => {
        stopUploadTimer();
        clearTimeout(headerTimer);
        if (response.destroyed || response.writableEnded) return;
        if (response.headersSent) response.destroy();
        else if (timedOut) fail(504, "gateway_timeout", "Node did not respond in time");
        else fail(502, "bad_gateway", "Node is unavailable");
      });
      upstream.once("response", (incoming) => {
        receivedResponse = true;
        stopUploadTimer();
        clearTimeout(headerTimer);
        upstream.setTimeout(timeoutMs, timeout);
        if (response.destroyed) {
          incoming.destroy();
          return;
        }
        const headers = endToEnd(incoming.headers);
        if (web) {
          // Published pages intentionally run in the Hub origin with the Node's hosting policy.
          response.removeHeader("Content-Security-Policy");
          if (incoming.headers.location?.startsWith("/web/"))
            headers.location = `/nodes/${node.id}${incoming.headers.location}`;
        }
        response.writeHead(incoming.statusCode ?? 502, headers);
        incoming.on("error", () => response.destroy());
        incoming.pipe(response);
      });
      request.on("error", abort);
      request.on("data", refreshUploadTimer);
      request.pipe(upstream);
      return true;
    },
    handle(request, downstream, head) {
      const reject = (status: number) => {
        if (downstream.destroyed || downstream.writableEnded) return;
        downstream.end(
          `HTTP/1.1 ${status} ${STATUS_CODES[status]}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`,
        );
      };
      let url: URL;
      try {
        url = requestUrl(request);
      } catch (error) {
        if (error instanceof MalformedRequestError) return reject(400);
        throw error;
      }
      const match = API_PATH.exec(url.pathname);
      const node = match && nodes.get(match[1]);
      const path = match && "/api" + match[2];
      downstream.on("error", () => downstream.destroy());
      if (!node || !path || !TERMINAL_PATH.test(path)) return reject(404);
      if (!sameOrigin(request)) return reject(403);
      const upstream = connect(request, node, path + url.search, true);
      let peer: Duplex | undefined;
      let closed = false;
      const abort = () => downstream.destroy();
      active.add(abort);
      const timer = setTimeout(() => {
        upstream.destroy();
        reject(504);
      }, timeoutMs);
      downstream.once("close", () => {
        closed = true;
        clearTimeout(timer);
        active.delete(abort);
        upstream.destroy();
        peer?.destroy();
      });
      upstream.on("error", () => {
        if (closed || peer) return;
        clearTimeout(timer);
        reject(502);
      });
      upstream.once("response", (incoming) => {
        clearTimeout(timer);
        incoming.destroy();
        reject(incoming.statusCode ?? 502);
      });
      upstream.once("upgrade", (incoming, socket, buffered) => {
        clearTimeout(timer);
        peer = socket;
        socket.on("error", abort);
        socket.once("close", abort);
        if (closed) return void socket.destroy();
        const headers = [];
        for (let index = 0; index < incoming.rawHeaders.length; index += 2)
          headers.push(`${incoming.rawHeaders[index]}: ${incoming.rawHeaders[index + 1]}`);
        downstream.write(`HTTP/1.1 101 Switching Protocols\r\n${headers.join("\r\n")}\r\n\r\n`);
        if (buffered.length) downstream.write(buffered);
        if (head.length) socket.write(head);
        downstream.pipe(socket).pipe(downstream);
      });
      upstream.end();
    },
    close() {
      for (const abort of active) abort();
      httpAgent.destroy();
      httpsAgent.destroy();
    },
  };
}

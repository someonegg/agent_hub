import { once } from "node:events";
import { writeFile } from "node:fs/promises";
import { createServer as createHttpServer, type IncomingMessage, request } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { Duplex } from "node:stream";
import { setTimeout as delay } from "node:timers/promises";

import { expect, it } from "vitest";
import WebSocket, { WebSocketServer } from "ws";

import { loadConfig, type ServerConfig } from "../../src/server/config.js";
import { DiffStore } from "../../src/server/hosting/diff-store.js";
import { hostingRoutes } from "../../src/server/hosting/routes.js";
import { listenServer, startServer } from "../../src/server/http/create-server.js";
import { createNodeProxy } from "../../src/server/http/node-proxy.js";
import { createTempDirectory } from "../helpers/temp-directories.js";

const session = "same-session-id-on-both-nodes";
const terminalPath = `/sessions/${session}/terminal-preview`;
const missingDiff = "f9be0848-0db4-44ca-98aa-e04d197bf63d";
const stalledDiff = "3d505c23-b325-4942-b933-c92952aa8ee8";

function address(server: { address(): unknown }) {
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

it("selects the mode without resolving local agents or storage for a multi-node Hub", () => {
  const result = loadConfig([
    "--node",
    "local=http://127.0.0.1:4174",
    "--node",
    "Local=https://example.test/",
    "--hosting",
    "--codex-agent",
    "unused",
  ]);
  expect(result).toMatchObject({
    kind: "run",
    config: { mode: { kind: "hub", nodes: [{ id: "local" }, { id: "Local" }] }, agents: [] },
  });
  if (result.kind !== "run") throw new Error("Expected run configuration");
  expect(result.config.uploadDirectory).toBeUndefined();
  expect(result.config.hostingDirectory).toBeUndefined();
  expect(loadConfig(["--node-only"])).toMatchObject({ config: { mode: { kind: "node" } } });
});

it.each([
  ["--node", "invalid_id=http://localhost"],
  ["--node", "node=ftp://localhost"],
  ["--node", "node=http://user:pass@localhost"],
  ["--node", "node=http://@localhost"],
  ["--node", "node=http://localhost/path"],
  ["--node", "node=http://localhost/?"],
  ["--node", "node=http://localhost/#"],
  ["--node", "node=http://localhost", "--node", "node=http://localhost"],
  ["--node", "node=http://localhost", "--node-only"],
  ["--node", "node=https://localhost", "--node-client-cert", "client.pem"],
])("rejects invalid node arguments %j", (...args) => {
  expect(() => loadConfig(args)).toThrow();
});

async function fixture(timeoutMs = 5000) {
  const hostingDirectory = await createTempDirectory("node-proxy-hosting-");
  const upstreams = ["local", "Remote"].map((id) => {
    const requests: IncomingMessage[] = [];
    const upgrades = new WebSocketServer({ noServer: true });
    const hosting = hostingRoutes(id === "local" ? hostingDirectory : undefined);
    const server = createHttpServer(async (request, response) => {
      requests.push(request);
      if (request.url?.endsWith("/hanging")) return;
      if (request.url === `/api/v1/diffs/${stalledDiff}`) return;
      if (request.url?.startsWith("/api/v1/diffs/") && (await hosting(request, response))) return;
      if (request.url?.endsWith("/rejected-upload")) {
        response.writeHead(413).end("Upload too large");
        return;
      }
      if (request.url?.endsWith("?reject-upgrade")) {
        response.writeHead(403).flushHeaders();
        return;
      }
      if (request.url?.includes("?after=")) {
        await delay(20);
        response.writeHead(204, { "Retry-After": "2" }).end();
      } else if (request.url?.startsWith("/web/")) {
        response.writeHead(302, { Location: "/web/page/snapshot/?view=1" }).end();
      } else {
        response.setHeader("Content-Type", "application/json");
        const chunks: Buffer[] = [];
        try {
          for await (const chunk of request) chunks.push(chunk);
        } catch (error) {
          if (request.aborted) return;
          throw error;
        }
        response.end(
          JSON.stringify({
            id,
            request: request.url,
            method: request.method,
            host: request.headers.host,
            origin: request.headers.origin,
            body: Buffer.concat(chunks).toString(),
          }),
        );
      }
    });
    server.on("upgrade", (request, socket, head) => {
      requests.push(request);
      upgrades.handleUpgrade(request, socket, head, (peer) => {
        peer.send(JSON.stringify({ id, origin: request.headers.origin }));
      });
    });
    return { server, upgrades, requests, id };
  });
  await Promise.all(upstreams.map(({ server }) => listenServer(server, 0, "127.0.0.1")));
  const offline = createHttpServer();
  await listenServer(offline, 0, "127.0.0.1");
  const offlineUrl = new URL(address(offline));
  await new Promise<void>((resolve) => offline.close(() => resolve()));
  const mode = {
    kind: "hub",
    nodes: [
      ...upstreams.map(({ id, server }) => ({ id, url: new URL(address(server)) })),
      { id: "offline", url: offlineUrl },
    ],
  } satisfies ServerConfig["mode"];
  const clientDirectory = await createTempDirectory("node-proxy-client-");
  await writeFile(
    join(clientDirectory, "index.html"),
    "<html><head></head><body>Hub</body></html>",
  );
  const proxy = createNodeProxy(mode, timeoutMs);
  const hub = await startServer(
    {
      mode,
      clientDirectory,
      port: 0,
      host: "127.0.0.1",
      agents: [],
      interactionEnabled: false,
      tls: { enabled: false },
    },
    proxy.route,
    () => {},
    proxy,
    { diffPageStatus: proxy.diffPageStatus },
  );
  const stop = () => new Promise<void>((resolve) => hub.close(() => resolve()));
  return {
    hub,
    url: address(hub),
    proxy,
    upstreams,
    hostingDirectory,
    stop,
    async cleanup() {
      if (hub.listening) await stop();
      await Promise.all(
        upstreams.map(({ server, upgrades }) => {
          for (const peer of upgrades.clients) peer.terminate();
          upgrades.close();
          server.closeAllConnections();
          return new Promise<void>((resolve) => server.close(() => resolve()));
        }),
      );
    },
  };
}

it("uses the target Node's diff status for both GET and HEAD without fetching the raw diff", async () => {
  const { url, upstreams, hostingDirectory, cleanup } = await fixture();
  try {
    const source = join(hostingDirectory, "source.diff");
    await writeFile(source, "diff --git a/file b/file\n");
    const store = new DiffStore(hostingDirectory);
    const entry = await store.publish(source);
    async function check(node: string, id: string, status: number) {
      for (const method of ["GET", "HEAD"]) {
        const response = await fetch(`${url}/nodes/${node}/diffs/${id}`, { method });
        expect(response.status).toBe(status);
        expect(response.headers.get("Cache-Control")).toBe("private, no-store");
        const body = await response.text();
        if (method === "HEAD") expect(body).toBe("");
        else expect(body).toContain("ahub-multi-node");
      }
    }
    await check("local", entry.id, 200);
    await check("local", missingDiff, 404);
    await check("Remote", entry.id, 404);
    await store.delete(entry.id);
    await check("local", entry.id, 404);
    await check("offline", entry.id, 502);
    expect(upstreams[0]!.requests.map(({ url, method }) => [url, method])).toEqual(
      [entry.id, entry.id, missingDiff, missingDiff, entry.id, entry.id].map((id) => [
        `/api/v1/diffs/${id}`,
        "HEAD",
      ]),
    );
    expect(upstreams[1]!.requests).toHaveLength(2);
  } finally {
    await cleanup();
  }
});

it("returns a gateway timeout when the Node does not respond to a diff probe", async () => {
  const { url, cleanup } = await fixture(100);
  try {
    const response = await fetch(`${url}/nodes/local/diffs/${stalledDiff}`, { method: "HEAD" });
    expect(response.status).toBe(504);
  } finally {
    await cleanup();
  }
});

it("cancels an in-flight diff probe when the client disconnects", async () => {
  const { url, upstreams, cleanup } = await fixture(35_000);
  const server = upstreams[0]!.server;
  const client = request(`${url}/nodes/local/diffs/${stalledDiff}`);
  client.on("error", () => {});
  try {
    const probing = once(server, "request");
    client.end();
    const [incoming] = await probing;
    expect(incoming.method).toBe("HEAD");
    const upstreamClosed = once(incoming.socket, "close");
    client.destroy();
    await expect(Promise.race([upstreamClosed.then(() => true), delay(1000, false)])).resolves.toBe(
      true,
    );
  } finally {
    client.destroy();
    await cleanup();
  }
});

it("isolates routes and preserves streams, upstream status, query, and response headers", async () => {
  const { url, upstreams, cleanup } = await fixture();
  try {
    expect(await (await fetch(url + "/api/nodes")).json()).toEqual({
      nodes: [{ id: "local" }, { id: "Remote" }, { id: "offline" }],
    });
    for (const path of ["/", "/index.html", "/nodes/local/", `/nodes/Remote/sessions/${session}`]) {
      const response = await fetch(url + path);
      expect(response.status).toBe(200);
      expect(await response.text()).toContain("ahub-multi-node");
    }
    for (const path of [
      "/api/v1/capabilities",
      "/api/nodes/missing/v1/sessions",
      "/api/nodes/remote/v1/sessions",
      "/nodes/remote/",
      "/nodes/missing/",
    ])
      expect((await fetch(url + path)).status).toBe(404);
    expect((await fetch(url + "/api/nodes/offline/v1/sessions")).status).toBe(502);

    const remote = upstreams[1]!;
    const remoteHost = new URL(address(remote.server)).host;
    const path = "/v1/uploads?filename=hello.txt";
    const response = await fetch(url + "/api/nodes/Remote" + path, {
      method: "POST",
      headers: { Origin: url },
      body: "hello",
    });
    expect(await response.json()).toEqual({
      id: "Remote",
      host: remoteHost,
      request: "/api" + path,
      method: "POST",
      body: "hello",
    });
    const { body } = await new Promise<{ body: string }>((resolve, reject) => {
      const streaming = request(
        url + "/api/nodes/Remote" + path,
        {
          method: "DELETE",
          headers: { "Transfer-Encoding": "chunked" },
        },
        async (response) => {
          try {
            const chunks: Buffer[] = [];
            for await (const chunk of response) chunks.push(chunk);
            resolve(JSON.parse(Buffer.concat(chunks).toString()));
          } catch (error) {
            reject(error);
          }
        },
      );
      streaming.once("error", reject);
      streaming.write("streamed ");
      streaming.end("delete");
    });
    expect(body).toBe("streamed delete");
    expect(upstreams[0]!.requests).toHaveLength(0);
    const catalog = await fetch(url + "/api/nodes/local/v1/sessions?after=revision");
    expect(catalog.status).toBe(204);
    expect(catalog.headers.get("retry-after")).toBe("2");
    expect(upstreams[0]!.requests[0]?.headers.origin).toBeUndefined();
    const hosted = await fetch(url + "/nodes/Remote/web/page/?view=1", { redirect: "manual" });
    expect(hosted.status).toBe(302);
    expect(hosted.headers.get("location")).toBe("/nodes/Remote/web/page/snapshot/?view=1");
    expect(hosted.headers.get("content-security-policy")).toBeNull();
  } finally {
    await cleanup();
  }
});

it("checks Origin on API writes, Web writes, and upgrades and omits it upstream", async () => {
  const { url, upstreams, cleanup } = await fixture();
  try {
    const routes = [
      ["POST", "/sessions", { requestId: "new" }],
      ["POST", "/sessions", { requestId: "resume", resumeSessionId: session }],
      ["POST", `/sessions/${session}/archive`],
      ["POST", `/sessions/${session}/exit`],
      ["DELETE", `/sessions/${session}`],
      ["POST", "/uploads"],
      ["DELETE", `/sessions/${session}/uploads/item`],
    ] as const;
    for (const [method, path] of routes) {
      const response = await fetch(url + "/api/nodes/local/v1" + path, {
        method,
        headers: { Origin: "https://elsewhere.test", "X-Forwarded-Proto": "https" },
      });
      expect(response.status).toBe(403);
    }

    const webUrl = url + "/nodes/local/web/page/snapshot/";
    const deniedWeb = await fetch(webUrl, {
      method: "POST",
      headers: { Origin: "https://elsewhere.test" },
      redirect: "manual",
    });
    expect(deniedWeb.status).toBe(403);

    const wsUrl = url.replace("http:", "ws:") + "/api/nodes/local/v1" + terminalPath;
    const denied = new WebSocket(wsUrl, { origin: "https://elsewhere.test" });
    expect((await once(denied, "error"))[0]).toMatchObject({ message: /403/ });
    expect(upstreams[0]!.requests).toHaveLength(0);

    for (const [method, path, body] of routes) {
      for (const origin of [url, undefined]) {
        const response = await fetch(url + "/api/nodes/local/v1" + path, {
          method,
          ...(origin ? { headers: { Origin: origin } } : {}),
          ...(body ? { body: JSON.stringify(body) } : {}),
        });
        expect(await response.json()).toMatchObject({
          id: "local",
          body: body ? JSON.stringify(body) : "",
        });
      }
    }
    for (const origin of [url, undefined]) {
      const ws = new WebSocket(wsUrl, { origin });
      const [data] = await once(ws, "message");
      expect(JSON.parse(data.toString())).toEqual({ id: "local" });
      const closed = once(ws, "close");
      ws.close();
      await closed;
    }
    const allowedWeb = await fetch(webUrl, {
      method: "POST",
      headers: { Origin: url },
      redirect: "manual",
    });
    expect(allowedWeb.status).toBe(302);
    for (const request of upstreams[0]!.requests) {
      expect(request.headers.origin).toBeUndefined();
    }

    const ws = new WebSocket(wsUrl, { origin: url });
    await once(ws, "open");
    const closed = once(ws, "close");
    for (const peer of upstreams[0]!.upgrades.clients) peer.terminate();
    await closed;
  } finally {
    await cleanup();
  }
});

it("releases upstream requests on client cancellation, timeout, and Hub shutdown", async () => {
  const { url, upstreams, stop, cleanup } = await fixture(350);
  const upstream = upstreams[0]!.server;
  const path = url + "/api/nodes/local/v1/hanging";
  try {
    const seen = once(upstream, "request");
    const controller = new AbortController();
    const cancelled = fetch(path, { signal: controller.signal }).catch((reason: unknown) => reason);
    const [, response] = await seen;
    const upstreamClosed = once(response, "close");
    controller.abort();
    expect(await cancelled).toMatchObject({ name: "AbortError" });
    await upstreamClosed;

    expect((await fetch(path)).status).toBe(504);

    const started = once(upstream, "request");
    const stopped = fetch(path).catch((reason: unknown) => reason);
    const [, outstanding] = await started;
    const released = once(outstanding, "close");
    await stop();
    expect(await stopped).toMatchObject({ name: "TypeError" });
    await released;
  } finally {
    await cleanup();
  }
});

it("forwards an active upload past the header deadline and times out a stalled upload", async () => {
  const { url, cleanup } = await fixture(400);
  const path = url + "/api/nodes/local/v1/upload";
  const upload = () => request(path, { method: "POST", headers: { "Content-Length": "4" } });
  try {
    const slow = upload();
    const slowResponse = once(slow, "response");
    slow.write("a");
    for (const chunk of ["b", "c"]) {
      await delay(160);
      slow.write(chunk);
    }
    await delay(160);
    slow.end("d");
    const [response] = await slowResponse;
    expect(response.statusCode).toBe(200);
    const chunks: Buffer[] = [];
    for await (const chunk of response) chunks.push(chunk);
    expect(JSON.parse(Buffer.concat(chunks).toString())).toMatchObject({ body: "abcd" });

    const stalled = upload();
    const stalledResponse = once(stalled, "response");
    stalled.write("a");
    const [timeout] = await stalledResponse;
    expect(timeout.statusCode).toBe(504);
    timeout.resume();
    stalled.destroy();
  } finally {
    await cleanup();
  }
});

it("forwards an early upload rejection and releases the unfinished upstream request", async () => {
  const { url, upstreams, cleanup } = await fixture(500);
  const upload = request(url + "/api/nodes/local/v1/rejected-upload", {
    method: "POST",
    headers: { "Content-Length": "4" },
  });
  const upstreamClosed = new Promise<void>((resolve) => {
    upstreams[0]!.server.once("request", (incoming) => incoming.socket.once("close", resolve));
  });
  try {
    const rejected = once(upload, "response");
    upload.write("a");
    const [response] = await rejected;
    expect(response.statusCode).toBe(413);
    const chunks: Buffer[] = [];
    for await (const chunk of response) chunks.push(chunk);
    expect(Buffer.concat(chunks).toString()).toBe("Upload too large");
    await expect(Promise.race([upstreamClosed.then(() => true), delay(1000, false)])).resolves.toBe(
      true,
    );
  } finally {
    upload.destroy();
    await cleanup();
  }
});

it("closes a refused WebSocket upstream without waiting for the downstream to close", async () => {
  const { proxy, upstreams, cleanup } = await fixture();
  const server = upstreams[0]!.server;
  server.removeAllListeners("upgrade");
  const upstreamClosed = new Promise<void>((resolve) => {
    server.once("request", (incoming) => incoming.socket.once("close", resolve));
  });
  const chunks: Buffer[] = [];
  const downstream = new Duplex({
    read() {},
    write(chunk: Buffer, _encoding, done) {
      chunks.push(chunk);
      done();
    },
  });
  try {
    const finished = once(downstream, "finish");
    proxy.handle(
      {
        url: `/api/nodes/local/v1${terminalPath}?reject-upgrade`,
        headers: {},
        socket: downstream,
      } as IncomingMessage,
      downstream,
      Buffer.alloc(0),
    );
    await finished;
    expect(Buffer.concat(chunks).toString()).toMatch(/^HTTP\/1\.1 403 Forbidden\r\n/);
    expect(downstream.destroyed).toBe(false);
    await expect(Promise.race([upstreamClosed.then(() => true), delay(1000, false)])).resolves.toBe(
      true,
    );
  } finally {
    downstream.destroy();
    await cleanup();
  }
});

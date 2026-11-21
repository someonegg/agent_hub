import type * as NodeFs from "node:fs";
import { createReadStream } from "node:fs";
import type * as NodeFsPromises from "node:fs/promises";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { join } from "node:path";
import { PassThrough } from "node:stream";

import { expect, it, vi } from "vitest";

import { DiffStore } from "../../src/server/hosting/diff-store.js";
import { hostingRoutes } from "../../src/server/hosting/routes.js";
import { HostingStore } from "../../src/server/hosting/store.js";
import { reportRequestError } from "../../src/server/http/request-errors.js";
import { createTempDirectory } from "../helpers/temp-directories.js";

vi.mock("node:fs", async (original) => {
  const fs = await original<typeof NodeFs>();
  return { ...fs, createReadStream: vi.fn(fs.createReadStream) };
});
vi.mock("node:fs/promises", async (original) => {
  const fs = await original<typeof NodeFsPromises>();
  return { ...fs, readFile: vi.fn(fs.readFile) };
});
async function publishedArtifact() {
  const root = await createTempDirectory("hosting-errors-");
  const source = join(root, "source");
  await mkdir(source);
  await writeFile(join(source, "index.html"), "page");
  const store = new HostingStore(join(root, "hosting"));
  const artifact = await store.publish(source, root);
  return { store, artifact };
}

it("propagates artifact storage permission failures", async () => {
  const { store, artifact } = await publishedArtifact();
  const denied = Object.assign(new Error("storage denied"), { code: "EACCES" });
  vi.mocked(readFile).mockRejectedValueOnce(denied);
  await expect(store.get(artifact.id)).rejects.toBe(denied);
});

it("propagates permission and I/O failures from diff metadata reads", async () => {
  const root = await createTempDirectory("diff-errors-");
  const source = join(root, "test.diff");
  await writeFile(source, "diff content");
  const store = new DiffStore(join(root, "hosting"));
  const entry = await store.publish(source);
  for (const code of ["EACCES", "EIO"]) {
    const failure = Object.assign(new Error("storage failure"), { code });
    for (const read of [
      () => store.list(),
      () => store.get(entry.id),
      () => store.exists(entry.id),
    ]) {
      vi.mocked(readFile).mockRejectedValueOnce(failure);
      await expect(read(), code).rejects.toBe(failure);
    }
  }
});

it("logs stream errors and destroys the response without writing JSON", async () => {
  const { store, artifact } = await publishedArtifact();
  const stream = new PassThrough();
  vi.mocked(createReadStream).mockReturnValueOnce(
    stream as unknown as ReturnType<typeof createReadStream>,
  );
  const response = new PassThrough() as unknown as ServerResponse;
  response.setHeader = vi.fn();
  response.removeHeader = vi.fn();
  const end = vi.spyOn(response, "end");
  const logger = { error: vi.fn() };
  const router = hostingRoutes(store.root, { logger, requestId: () => "stream-request" });
  const request = {
    method: "GET",
    url: `/web/${artifact.id}/${artifact.snapshotId}/`,
  } as IncomingMessage;
  expect(await router(request, response)).toBe(true);
  const error = new Error("stream failure");
  stream.destroy(error);
  await vi.waitFor(() => expect(logger.error).toHaveBeenCalledTimes(1));
  expect(response.destroyed).toBe(true);
  expect(end).not.toHaveBeenCalled();
  expect(logger.error).toHaveBeenCalledExactlyOnceWith("HTTP request failed", {
    requestId: "stream-request",
    method: "GET",
    path: request.url,
    error,
  });
});

it("closes the published file stream when the client disconnects", async () => {
  const { store, artifact } = await publishedArtifact();
  const stream = new PassThrough();
  vi.mocked(createReadStream).mockReturnValueOnce(
    stream as unknown as ReturnType<typeof createReadStream>,
  );
  const response = new PassThrough() as unknown as ServerResponse;
  response.setHeader = vi.fn();
  response.removeHeader = vi.fn();
  const logger = { error: vi.fn() };
  const router = hostingRoutes(store.root, { logger });
  const request = {
    method: "GET",
    url: `/web/${artifact.id}/${artifact.snapshotId}/`,
  } as IncomingMessage;

  expect(await router(request, response)).toBe(true);
  const closed = new Promise<void>((resolve) => stream.once("close", resolve));
  response.destroy();
  await closed;
  expect(stream.destroyed).toBe(true);
  expect(logger.error).not.toHaveBeenCalled();
});

it("logs failures after headers and never sends a second response", () => {
  const response = {
    headersSent: true,
    destroy: vi.fn(),
    setHeader: vi.fn(),
    end: vi.fn(),
  } as unknown as ServerResponse;
  const logger = { error: vi.fn() };
  reportRequestError(
    { method: "GET", url: "/web/test/" } as IncomingMessage,
    response,
    new Error("late failure"),
    { logger },
  );
  expect(logger.error).toHaveBeenCalledTimes(1);
  expect(response.destroy).toHaveBeenCalledTimes(1);
  expect(response.setHeader).not.toHaveBeenCalled();
  expect(response.end).not.toHaveBeenCalled();
});

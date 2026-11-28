import type * as FsPromises from "node:fs/promises";
import { appendFile, mkdir, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { expect, it, vi } from "vitest";

import { createClaudeSessionSource } from "../../src/server/adapters/claude/claude-session-source.js";
import { isExpectedIoError } from "../../src/server/adapters/shared/io-errors.js";
import { CheckpointedJsonlDecoder } from "../../src/server/adapters/shared/jsonl-decoder.js";
import { createTempDirectory } from "../helpers/temp-directories.js";

const hooks = vi.hoisted(() => ({
  afterStat: null as null | (() => Promise<void>),
  failure: null as null | { operation: string; error: Error },
}));
vi.mock("node:fs/promises", async (importOriginal) => {
  const fs = await importOriginal<typeof FsPromises>();
  return {
    ...fs,
    readdir: async (...args: Parameters<typeof fs.readdir>) => {
      if (
        (hooks.failure?.operation === "readdir" && String(args[0]).endsWith("/projects")) ||
        (hooks.failure?.operation === "project" && String(args[0]).endsWith("/project"))
      )
        throw hooks.failure.error;
      return fs.readdir(...args);
    },
    stat: async (...args: Parameters<typeof fs.stat>) => {
      if (hooks.failure?.operation === "stat") throw hooks.failure.error;
      return fs.stat(...args);
    },
    open: async (...args: Parameters<typeof fs.open>) => {
      const handle = await fs.open(...args);
      const originalStat = handle.stat.bind(handle);
      handle.stat = (async () => {
        const info = await originalStat();
        const hook = hooks.afterStat;
        hooks.afterStat = null;
        await hook?.();
        return info;
      }) as typeof handle.stat;
      return handle;
    },
  };
});

it("fixes EOF and uses the opened inode", async () => {
  const agent = await createTempDirectory("jsonl-eof-");
  const path = join(agent, "log.jsonl");
  const first = '{"value":"first"}\n';
  const second = '{"value":"second"}\n';
  await writeFile(path, first);
  const descriptor = { path };
  const decoder = new CheckpointedJsonlDecoder();
  hooks.afterStat = () => appendFile(path, second);
  const before = await decoder.decode(descriptor);
  expect(before.records.map((r) => r.value.value)).toEqual(["first"]);
  expect(before.checkpoint.observedEof).toBe(Buffer.byteLength(first));
  const after = await decoder.decode(descriptor, before.checkpoint);
  expect(after.records.map((r) => r.value.value)).toEqual(["second"]);
  hooks.afterStat = async () => {
    await rename(path, path + ".old");
    await writeFile(path, '{"value":"replacement with different length"}\n');
  };
  const replaced = await decoder.decode(descriptor);
  expect(replaced.records.map((r) => r.value.value)).toEqual(["first", "second"]);
  expect(replaced.checkpoint.observedEof).toBe(Buffer.byteLength(first + second));
  expect((await decoder.decode(descriptor)).records[0]?.value.value).toBe(
    "replacement with different length",
  );
});

it.each(["ESTALE", "EISDIR", "ELOOP", "EACCES"])(
  "bounds Claude file and directory diagnostics for %s",
  async (code) => {
    const agent = await createTempDirectory("claude-io-");
    await mkdir(join(agent, "projects/project"), { recursive: true });
    await writeFile(
      join(agent, "projects/project/11111111-2222-4333-8444-555555555555.jsonl"),
      "{}\n",
    );
    const source = await createClaudeSessionSource(agent);
    const error = Object.assign(new Error(code), { code });
    expect(isExpectedIoError(error)).toBe(true);
    try {
      for (const [operation, diagnostic] of [
        ["stat", "session_unavailable"],
        ["project", "project_unavailable"],
        ["readdir", "source_unavailable"],
      ]) {
        hooks.failure = { operation, error };
        expect((await source.refresh()).diagnostics).toMatchObject([{ code: diagnostic }]);
      }
      const unexpected = Object.assign(new Error("unknown error"), { code: "UNKNOWN" });
      expect(isExpectedIoError(unexpected)).toBe(false);
      for (const operation of ["stat", "readdir"]) {
        hooks.failure = { operation, error: unexpected };
        await expect(source.refresh()).rejects.toThrow("unknown error");
      }
    } finally {
      hooks.failure = null;
    }
  },
);

it("keeps the head handle through continuation and defers post-stat appends", async () => {
  const root = await createTempDirectory("jsonl-head-eof-");
  const path = join(root, "log.jsonl");
  const original = '{"head":true}\n' + JSON.stringify({ body: "界".repeat(30000) }) + "\n";
  const appended = '{"appended":true}\n';
  await writeFile(path, original);
  const decoder = new CheckpointedJsonlDecoder();
  hooks.afterStat = () => appendFile(path, appended);
  const first = await decoder.decode({ path }, undefined, {
    maxBytes: 65536,
    inspect: () => "continue",
  });
  if (first.mode === "stopped") throw new Error("unexpected stop");
  expect(first.records.map((r) => Object.keys(r.value)[0])).toEqual(["head", "body"]);
  expect(first.telemetry.totalBytes).toBe(Buffer.byteLength(original));
  const next = await decoder.decode({ path }, first.checkpoint);
  expect(next.mode).toBe("append");
  expect(next.records.map((r) => r.value)).toEqual([{ appended: true }]);

  // Replace the path after the head has actually been parsed, before continuation.
  const replacement = join(root, "replacement.jsonl");
  await writeFile(replacement, '{"replacement":true}\n');
  const { renameSync } = await import("node:fs");
  const retained = await decoder.decode({ path }, undefined, {
    maxBytes: 65536,
    inspect: () => {
      renameSync(replacement, path);
      return "continue";
    },
  });
  if (retained.mode === "stopped") throw new Error("unexpected stop");
  expect(retained.records.map((r) => Object.keys(r.value)[0])).toEqual([
    "head",
    "body",
    "appended",
  ]);
  expect((await decoder.decode({ path })).records.map((r) => r.value)).toEqual([
    { replacement: true },
  ]);
});

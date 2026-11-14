import { appendFile, mkdir, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { expect, it, vi } from "vitest";

import { CodexSessionSource } from "../../src/server/adapters/codex/codex-session-source.js";
import { DefaultSessionNormalizer } from "../../src/server/adapters/codex/session-normalizer.js";
import { CheckpointedJsonlDecoder } from "../../src/server/adapters/shared/jsonl-decoder.js";
import { createTempDirectory } from "../helpers/temp-directories.js";

const line = (value: unknown) => JSON.stringify(value) + "\n";
const meta = (payload: object) => line({ type: "session_meta", payload });
const padding = () => line({ type: "event_msg", payload: { message: "x".repeat(100_000) } });

async function setup(content: string) {
  const root = await createTempDirectory("codex-filter-");
  await mkdir(join(root, "sessions"));
  const file = join(root, "sessions/rollout-test.jsonl");
  await writeFile(file, content);
  const decoder = new CheckpointedJsonlDecoder();
  const decode = vi.fn(decoder.decode.bind(decoder));
  const normalizer = new DefaultSessionNormalizer();
  const append = vi.spyOn(normalizer, "append");
  const materialize = vi.spyOn(normalizer, "materialize");
  const source = new CodexSessionSource(root, root, { decoder: { decode }, normalizer });
  return { root, file, source, decode, append, materialize };
}

it.each([
  { parent_thread_id: "parent" },
  { parent_id: "parent" },
  { source: { subagent: "reviewer" } },
  { source: { subagent: { thread_spawn: { parent_thread_id: "parent" } } } },
  { source: { subagent: {} } },
])(
  "bounds head reads and filters native metadata %j before decoding or normalization",
  async (marker) => {
    const { source, decode, append, materialize } = await setup(
      meta({ id: "test", ...marker }) + padding(),
    );
    const snapshot = await source.refresh();
    expect(snapshot.sessions).toEqual([]);
    expect(snapshot.bindings).toEqual([]);
    expect(snapshot.diagnostics).toEqual([]);
    expect(decode).not.toHaveBeenCalled();
    expect(append).not.toHaveBeenCalled();
    expect(materialize).not.toHaveBeenCalled();
    expect(source.lastRefreshTelemetry()).toMatchObject({
      probeBytes: 65536,
      decodeBytes: 0,
      fullFiles: 0,
    });
  },
);

it.each([
  meta({ id: "test", parent_id: "", parent_thread_id: 42, source: { subagent: null } }),
  line({ type: "event_msg", payload: { message: "parent_thread_id subagent parent_id" } }),
])("keeps ordinary and metadata-free rollouts: %s", async (content) => {
  const { source, decode } = await setup(content);
  expect((await source.refresh()).sessions).toHaveLength(1);
  expect(decode).toHaveBeenCalledTimes(1);
});

it.each([
  padding() + meta({ id: "test", parent_id: "parent" }),
  meta({ id: "unmatched", parent_id: "parent" }) + padding(),
  // An incomplete first line requires the complete decoder to establish identity.
  meta({ id: "test", parent_thread_id: "parent", title: "x".repeat(100_000) }),
])("falls back to full identity decoding before filtering", async (content) => {
  const { source, decode, append, materialize } = await setup(content);
  expect((await source.refresh()).sessions).toEqual([]);
  expect(decode).toHaveBeenCalledTimes(1);
  expect(append).not.toHaveBeenCalled();
  expect(materialize).not.toHaveBeenCalled();
});

it("uses the filename-matching metadata rather than an earlier unrelated marker", async () => {
  const { source, decode } = await setup(
    meta({ id: "other", parent_id: "parent" }) + padding() + meta({ id: "test" }),
  );
  expect((await source.refresh()).sessions).toHaveLength(1);
  expect(decode).toHaveBeenCalledTimes(1);
});

it("keeps a definitive head selection when later metadata has a marker", async () => {
  const { source } = await setup(
    meta({ id: "test" }) + padding() + meta({ id: "other", parent_id: "parent" }),
  );
  expect((await source.refresh()).sessions).toHaveLength(1);
});

it("does not read excluded paths after append or replacement; absence and new instances reset identification", async () => {
  const { root, file, source, decode } = await setup(
    meta({ id: "test", parent_id: "parent" }) + padding(),
  );
  await source.refresh();
  await appendFile(file, padding());
  await source.refresh();
  expect(source.lastRefreshTelemetry()).toMatchObject({ probeBytes: 0, decodeBytes: 0 });
  await writeFile(file, meta({ id: "test" }));
  expect((await source.refresh()).sessions).toEqual([]);
  expect(source.lastRefreshTelemetry()).toMatchObject({ probeBytes: 0, decodeBytes: 0 });
  expect(decode).not.toHaveBeenCalled();
  expect((await new CodexSessionSource(root, root).refresh()).sessions).toHaveLength(1);
  await unlink(file);
  await source.refresh();
  await writeFile(file, meta({ id: "test" }));
  expect((await source.refresh()).sessions).toHaveLength(1);
  expect(decode).toHaveBeenCalledTimes(1);
});

it("retries read failures rather than excluding their paths", async () => {
  const { root, file } = await setup(padding() + meta({ id: "test", parent_id: "parent" }));
  const decoder = new CheckpointedJsonlDecoder();
  const decode = vi
    .fn(decoder.decode.bind(decoder))
    .mockRejectedValueOnce(Object.assign(new Error("unavailable"), { code: "EACCES" }));
  const source = new CodexSessionSource(root, root, { decoder: { decode } });
  expect((await source.refresh()).diagnostics).toMatchObject([{ code: "rollout_unavailable" }]);
  await writeFile(file, meta({ id: "test" }));
  expect((await source.refresh()).sessions).toHaveLength(1);
  expect(decode).toHaveBeenCalledTimes(2);
});

it("defers an incomplete metadata line until it is newline terminated", async () => {
  const { source, file, decode } = await setup(meta({ id: "test", parent_id: "parent" }).trimEnd());
  expect((await source.refresh()).sessions).toHaveLength(1);
  expect(decode).toHaveBeenCalledTimes(1);
  await appendFile(file, "\n");
  expect((await source.refresh()).sessions).toEqual([]);
});

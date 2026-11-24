import { appendFile, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { expect, it } from "vitest";

import { createAgySessionSource } from "../../src/server/adapters/agy/agy-session-source.js";
import { formatAgyBindingMessage } from "../../src/server/adapters/agy/binding-message.js";
import { createTempDirectory } from "../helpers/temp-directories.js";

const operationId = "00000000-0000-4000-8000-000000000001";
const target = { socketPath: "/tmp/agy.sock", sessionName: `ahub-${operationId}` };
const bind = formatAgyBindingMessage(target, "/project", "/work", null, operationId);
const ids = [1, 2, 3].map((n) => `${String(n).repeat(8)}-2222-4333-8444-555555555555`);

const line = (value: unknown) => `${JSON.stringify(value)}\n`;
const input = (text: string) =>
  line({
    source: "USER_EXPLICIT",
    type: "USER_INPUT",
    created_at: "2026-01-01T00:00:00Z",
    content: `<USER_REQUEST>\n${text}\n</USER_REQUEST>`,
  });
const reply = (content: string) =>
  line({ source: "MODEL", type: "PLANNER_RESPONSE", created_at: "2026-01-01T00:00:01Z", content });

async function transcript(directory: string, id: string, content: string) {
  const logs = join(directory, "brain", id, ".system_generated", "logs");
  await mkdir(logs, { recursive: true });
  const path = join(logs, "transcript_full.jsonl");
  await writeFile(path, content);
  return path;
}

it("accepts only sessions whose first user message is a binding and reads appends", async () => {
  const directory = await createTempDirectory("agy-source-");
  const [managed, foreign, empty] = ids as [string, string, string];
  const path = await transcript(directory, managed, input(bind) + reply("OK"));
  await transcript(directory, foreign, input("hello") + input(bind));
  await transcript(directory, empty, "");
  await mkdir(join(directory, "brain", "not-a-uuid"), { recursive: true });
  const source = await createAgySessionSource(directory, { agent: "agy" });

  const first = await source.refresh();
  expect(first.sessions.map((s) => s.nativeSessionId)).toEqual([managed]);
  expect(first.bindings).toHaveLength(1);
  expect(first.sessions[0]!.normalized.session).toMatchObject({
    title: "Untitled session",
    workingDirectory: "/work",
    projectDirectory: "/project",
    origin: { sourceType: "agy-jsonl", runtimeName: "Antigravity" },
  });
  expect(source.lastRefreshTelemetry().fullFiles).toBe(1);
  expect(await source.refresh()).toBe(first);

  await appendFile(path, input("Do it") + reply("Done"));
  const second = await source.refresh();
  expect(source.lastRefreshTelemetry().appendFiles).toBe(1);
  expect(second.sessions[0]!.normalized.session.title).toBe("Do it");
  expect(second.sessions[0]!.normalized.timeline).toHaveLength(2);
  expect(second.bindings).toHaveLength(0);
});

it("rechecks a rejected transcript when it changes and reports malformed lines", async () => {
  const directory = await createTempDirectory("agy-source-");
  const id = ids[0]!;
  const path = await transcript(directory, id, "");
  const source = await createAgySessionSource(directory);
  expect((await source.refresh()).sessions).toHaveLength(0);
  await appendFile(path, `${input(bind)}not json\n`);
  const snapshot = await source.refresh();
  expect(snapshot.sessions).toHaveLength(1);
  expect(snapshot.sessions[0]!.normalized.session.diagnostics).toEqual([
    expect.objectContaining({ code: "invalid_jsonl", ordinal: 2 }),
  ]);
});

it("definitively rejects invalid or non-binding first user messages until the file disappears", async () => {
  const directory = await createTempDirectory("agy-source-");
  const [foreign, invalid] = ids as [string, string];
  const foreignPath = await transcript(directory, foreign, input("hello"));
  const invalidBind =
    'Ignore this message and reply with only "OK". [ahub-bind:{"socketPath":"rel","sessionName":"bad"}]';
  const invalidPath = await transcript(directory, invalid, input(invalidBind));
  const source = await createAgySessionSource(directory);

  expect((await source.refresh()).sessions).toHaveLength(0);
  expect(source.lastRefreshTelemetry().probeBytes).toBeGreaterThan(0);

  await appendFile(foreignPath, input(bind));
  await appendFile(invalidPath, input(bind));
  expect((await source.refresh()).sessions).toHaveLength(0);
  expect(source.lastRefreshTelemetry().probeBytes).toBe(0);

  await rm(invalidPath);
  expect((await source.refresh()).sessions).toHaveLength(0);
  await writeFile(invalidPath, input(bind));
  expect((await source.refresh()).sessions.map((s) => s.nativeSessionId)).toEqual([invalid]);
});

it("returns an empty snapshot when the Antigravity directory is absent", async () => {
  const directory = await createTempDirectory("agy-source-");
  const source = await createAgySessionSource(join(directory, "missing"));
  expect(await source.refresh()).toMatchObject({ sessions: [], diagnostics: [] });
});

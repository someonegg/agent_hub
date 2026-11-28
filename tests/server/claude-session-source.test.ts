import { appendFile, cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { formatClaudeBindingMessage } from "../../src/server/adapters/claude/binding-message.js";
import { createClaudeSessionSource } from "../../src/server/adapters/claude/claude-session-source.js";
import { ClaudeSessionManager } from "../../src/server/adapters/claude/session-manager.js";
import {
  appendClaudeRecords,
  createClaudeState,
} from "../../src/server/adapters/claude/session-normalizer.js";
import { PROBE_BYTES } from "../../src/server/adapters/shared/jsonl-decoder.js";
import {
  MAX_JSONL_LINE_BYTES,
  MAX_MESSAGE_CHARS,
  MAX_SESSION_DIAGNOSTICS,
} from "../../src/server/adapters/shared/limits.js";
import { TmuxLauncher } from "../../src/server/interaction/tmux-launcher.js";
import { appendClaudeLines } from "../helpers/claude-normalizer.js";
import { createTempDirectory } from "../helpers/temp-directories.js";

const id = "11111111-2222-4333-8444-555555555555";
const fixture = join(import.meta.dirname, "../fixtures/claude-home");
const relative = `projects/project/${id}.jsonl`;
const lines = async () => (await readFile(join(fixture, relative), "utf8")).trimEnd().split("\n");

async function createSessionAgent(prefix: string) {
  const agent = await createTempDirectory(prefix);
  await mkdir(join(agent, "projects/project"), { recursive: true });
  return { agent, path: join(agent, relative) };
}

describe("Claude JSONL adapter", () => {
  it("maps line evidence, preserves block order and hides native shell, API copies and subagents", async () => {
    const state = await appendClaudeLines(createClaudeState(id), await lines());
    expect(
      state.timeline.map((item) =>
        item.kind === "message" ? item.markdown : `${item.stage}:${item.callId}`,
      ),
    ).toEqual([
      "Hello",
      "First update",
      "Second part",
      "Before question",
      "request:ask",
      "After question",
      "response:ask",
      "## Native plan",
      "request:reject",
      "response:reject",
      "request:unknown",
      "response:unknown",
      "Main assistant body",
    ]);
    expect(state.timeline.slice(0, 4).map((item) => item.kind === "message" && item.phase)).toEqual(
      [null, "update", "response", "update"],
    );
    expect(state.timeline[6]).toMatchObject({
      outcome: "answered",
      answers: [{ questionId: "ask:0", answers: ["One", "Two"] }],
    });
    expect(state.timeline[7]).toMatchObject({ itemType: "plan", phase: "response" });
    expect(state.timeline[9]).toMatchObject({ outcome: "aborted" });
    expect(state.timeline[11]).toMatchObject({ outcome: "unavailable" });
  });

  it("produces identical immutable timelines for every incremental split", async () => {
    const input = await lines();
    const full = await appendClaudeLines(createClaudeState(id), input);
    for (let split = 0; split <= input.length; split++) {
      const before = await appendClaudeLines(createClaudeState(id), input.slice(0, split));
      const serialized = JSON.stringify(before.timeline);
      const after = await appendClaudeLines(before, input.slice(split));
      expect(after).toEqual(full);
      expect(JSON.stringify(before.timeline)).toBe(serialized);
      before.timeline.forEach((item, index) => expect(after.timeline[index]).toBe(item));
    }
    expect(full.timeline.map((item) => item.ordinal)).toEqual(
      full.timeline.map((_, index) => index + 1),
    );
  });

  it("does not infer a final phase from missing or nonfinal stop reasons", async () => {
    const state = await appendClaudeLines(
      createClaudeState(id),
      [undefined, "max_tokens", "unknown"].map((stop_reason) =>
        JSON.stringify({
          type: "assistant",
          message: { role: "assistant", stop_reason, content: [{ type: "text", text: "body" }] },
        }),
      ),
    );
    expect(state.timeline).toEqual(
      Array.from({ length: 3 }, () => expect.objectContaining({ phase: null })),
    );
  });

  it("selects native title, cwd, and agent metadata", async () => {
    const source = await createClaudeSessionSource(fixture, { agent: "glm" });
    const entry = (await source.refresh()).sessions[0]!;
    expect(entry.normalized.session).toMatchObject({
      title: "Custom title",
      workingDirectory: "/test/latest-cwd",
      projectDirectory: "/test/project",
      taskName: null,
    });
    expect(entry.origin).toMatchObject({
      agent: "glm",
      runtimeName: "Claude Code",
      runtimeVersion: "2.1.318",
    });
  });

  it("commits complete lines, rereads tails, diagnoses malformed lines and rebuilds rewrites", async () => {
    const agent = await createTempDirectory("claude-source-");
    await cp(fixture, agent, { recursive: true });
    const path = join(agent, relative);
    const input = await lines();
    await writeFile(path, input[0] + "\n" + input[1]!.slice(0, 30));
    const source = await createClaudeSessionSource(agent);
    const first = await source.refresh();
    const before = JSON.stringify(first);
    expect(first.sessions[0]!.normalized.timeline).toHaveLength(1);
    await appendFile(path, input[1]!.slice(30) + "\n{bad\n" + input[2] + "\n");
    const appended = await source.refresh();
    expect(appended.sessions[0]!.normalized.timeline).toHaveLength(3);
    expect(appended.sessions[0]!.normalized.session.diagnostics).toMatchObject([
      { code: "invalid_jsonl" },
    ]);
    expect(JSON.stringify(first)).toBe(before);
    const fresh = await (await createClaudeSessionSource(agent)).refresh();
    expect(JSON.stringify(appended)).toEqual(JSON.stringify(fresh));
    await writeFile(path, input[0] + "\n");
    expect((await source.refresh()).sessions[0]!.normalized.timeline).toHaveLength(1);
    await writeFile(path, input[0]!.replace("Hello", "Other") + "\n");
    expect((await source.refresh()).sessions[0]!.normalized.timeline[0]).toMatchObject({
      markdown: "Other",
    });
  });

  it("does not recursively discover subagents and rejects conflicting native identities", async () => {
    const agent = await createTempDirectory("claude-identity-");
    await mkdir(join(agent, "projects/project/subagents"), { recursive: true });
    await writeFile(
      join(agent, "projects/project/subagents", `${id}.jsonl`),
      (await lines())[0] + "\n",
    );
    const source = await createClaudeSessionSource(agent);
    expect((await source.refresh()).sessions).toEqual([]);
    const conflictingId = "aaaaaaaa-2222-4333-8444-555555555555";
    for (const record of [
      (await lines())[0]!.replace(id, conflictingId),
      JSON.stringify({
        type: "user",
        session_id: conflictingId,
        message: {
          role: "user",
          content: formatClaudeBindingMessage(
            { socketPath: "/tmp/claude.sock", sessionName: `ahub-${id}` },
            "/project",
            "Task",
          ),
        },
      }),
    ]) {
      await writeFile(join(agent, relative), record + "\n");
      const snapshot = await source.refresh();
      expect(snapshot.sessions).toEqual([]);
      expect(snapshot.bindings).toEqual([]);
      expect(snapshot.diagnostics).toMatchObject([{ code: "conflicting_native_session_id" }]);
    }
  });
});

it("keeps Codex and Claude agents independently routed while merging project associations", async () => {
  const { createAhub } = await import("../../src/server/create-hub.js");
  const codex = await createTempDirectory("claude-mixed-codex-");
  await cp(join(import.meta.dirname, "../fixtures/codex-home"), codex, { recursive: true });
  const hub = await createAhub({
    agents: [
      { nickname: "codex", path: codex },
      { nickname: "glm", path: fixture, adapter: "claude" },
    ],
  });
  try {
    const snapshot = await hub.sessions.managementSnapshot();
    expect(snapshot.sessions.some((session) => session.origin.agent === "codex")).toBe(true);
    const claude = snapshot.sessions.find((session) => session.origin.agent === "glm")!;
    expect(claude.origin.runtimeName).toBe("Claude Code");
    expect(hub.managers.get("glm").isValidNativeId(claude.sourceId!)).toBe(true);
    expect(hub.managers.get("glm").archive).toBeTypeOf("function");
    expect(hub.managers.get("codex").archive).toBeTypeOf("function");
    expect((await hub.sessions.list()).agents).toEqual([
      { nickname: "codex", runtimeName: "Codex", management: { archive: true } },
      { nickname: "glm", runtimeName: "Claude Code", management: { archive: true } },
    ]);
  } finally {
    hub.close();
  }
});

it("rebuilds pane claims and filters binding messages across incremental reads", async () => {
  const { agent, path } = await createSessionAgent("claude-bindings-");
  const operationId = "00000000-0000-4000-8000-000000000001";
  const target = { socketPath: "/tmp/claude.sock", sessionName: `ahub-${operationId}` };
  const create = formatClaudeBindingMessage(target, "/project", "Task", operationId);
  const resume = formatClaudeBindingMessage(target, null, null, operationId);
  const handoff = formatClaudeBindingMessage(target, "/moved-project", "Updated task");
  const invalidMetadata = resume.replace("}]", ',"projectDirectory":"relative","taskName":42}]');
  const invalidSocket = resume.replace(target.socketPath, "relative");
  const invalidSession = resume.replace(target.sessionName, "wrong-session");
  const invalidOperation = resume.replace(
    `"operationId":"${operationId}"`,
    '"operationId":"invalid"',
  );
  const row = (content: unknown, extra = {}) =>
    JSON.stringify({
      type: "user",
      sessionId: id,
      cwd: "/worktree",
      message: { role: "user", content },
      ...extra,
    }) + "\n";
  const source = await createClaudeSessionSource(agent);
  await writeFile(path, row(create));
  const initial = await source.refresh();
  expect(initial.sessions[0]!.normalized).toMatchObject({
    session: {
      title: "Untitled session",
      workingDirectory: "/worktree",
      projectDirectory: "/project",
      taskName: "Task",
    },
    timeline: [],
  });
  expect(initial.bindings).toMatchObject([
    {
      attempt: {
        ...target,
        operationId,
        projectDirectory: "/project",
        taskName: "Task",
        valid: true,
      },
    },
  ]);
  const acknowledgmentRow = (content: unknown) =>
    row(content, {
      type: "assistant",
      message: { id: "msg_create_ack", role: "assistant", stop_reason: "end_turn", content },
    });
  await appendFile(path, acknowledgmentRow([{ type: "thinking", thinking: "ack" }]));
  expect((await source.refresh()).sessions[0]!.normalized.timeline).toEqual([]);
  await appendFile(path, acknowledgmentRow([{ type: "text", text: "OK" }]));
  const acknowledged = await source.refresh();
  expect(acknowledged.bindings).toEqual([]);
  expect(acknowledged.sessions[0]!.normalized.timeline).toEqual([]);
  expect(acknowledged.sessions[0]!.normalized.session.title).toBe("Untitled session");
  await appendFile(
    path,
    row("Real title") +
      row(resume, { isSidechain: true }) +
      row(resume, { isMeta: true }) +
      row(resume, { type: "api-request-blob" }) +
      row([{ type: "tool_result", content: resume }]) +
      row([
        { type: "text", text: resume },
        { type: "text", text: "extra" },
      ]) +
      row([
        { type: "text", text: "<system-reminder>hook context</system-reminder>" },
        { type: "text", text: "<system-context>ctx</system-context>" },
        { type: "text", text: "<ide_opened_file>a.ts</ide_opened_file>" },
        { type: "text", text: "<ide_selection>line 1</ide_selection>" },
        { type: "text", text: resume },
      ]) +
      row(handoff) +
      row(invalidMetadata) +
      row(invalidSocket) +
      row(invalidSession) +
      row(invalidOperation) +
      row(`Quote: ${resume}`) +
      row(resume + "\n[note]") +
      row("OK", {
        type: "assistant",
        session_id: operationId,
        message: { role: "assistant", content: "OK" },
      }),
  );
  const appended = await source.refresh();
  expect(appended.bindings).toMatchObject([
    { attempt: { ...target, operationId, valid: true } },
    {
      attempt: {
        ...target,
        valid: true,
        projectDirectory: "/moved-project",
        taskName: "Updated task",
      },
    },
    { attempt: { ...target, operationId, valid: true } },
    { attempt: { valid: false } },
    { attempt: { valid: false } },
    { attempt: { valid: false } },
  ]);
  expect(appended.sessions[0]!.normalized.session).toMatchObject({
    title: "Real title",
    projectDirectory: "/moved-project",
    taskName: "Updated task",
  });
  expect(
    appended.sessions[0]!.normalized.timeline.map(
      (item) => item.kind === "message" && item.markdown,
    ),
  ).toEqual(["Real title", resume + "\n\nextra", `Quote: ${resume}`, resume + "\n[note]", "OK"]);
  const fresh = await (await createClaudeSessionSource(agent)).refresh();
  expect(fresh.bindings).toEqual([...initial.bindings!, ...appended.bindings!]);
  expect(fresh.sessions[0]!.normalized.session).toEqual(appended.sessions[0]!.normalized.session);
  expect(fresh.sessions[0]!.normalized.timeline).toEqual(appended.sessions[0]!.normalized.timeline);
});

it("decodes only append bytes, skips unchanged files and caps resource usage", async () => {
  const { agent, path } = await createSessionAgent("claude-limits-");
  const row = (content: string) =>
    JSON.stringify({ type: "user", message: { role: "user", content } }) + "\n";
  await writeFile(
    path,
    "bad\n".repeat(MAX_SESSION_DIAGNOSTICS + 20) +
      "x".repeat(MAX_JSONL_LINE_BYTES + 1) +
      "\n" +
      row("x".repeat(MAX_MESSAGE_CHARS - 1) + "😀end"),
  );
  const source = await createClaudeSessionSource(agent);
  const first = await source.refresh();
  expect(first.sessions[0]!.normalized.session.diagnostics).toHaveLength(MAX_SESSION_DIAGNOSTICS);
  const item = first.sessions[0]!.normalized.timeline[0]!;
  expect(item).toMatchObject({ markdown: "x".repeat(MAX_MESSAGE_CHARS - 1) });
  expect(source.lastRefreshTelemetry().fullFiles).toBe(1);
  await source.refresh();
  expect(source.lastRefreshTelemetry()).toMatchObject({
    fullFiles: 0,
    appendFiles: 0,
    decodeBytes: 0,
    probeBytes: 0,
  });
  const append = row("next");
  await appendFile(path, append);
  const next = await source.refresh();
  expect(source.lastRefreshTelemetry()).toMatchObject({
    fullFiles: 0,
    appendFiles: 1,
    decodeBytes: Buffer.byteLength(append),
    probeBytes: PROBE_BYTES * 2,
  });
  expect(next.sessions[0]!.normalized.timeline).toHaveLength(2);
  expect(next.signature).not.toBe(first.signature);
});

it("keeps the accepted duplicate path until it becomes invalid", async () => {
  const agent = await createTempDirectory("claude-duplicates-");
  await mkdir(join(agent, "projects/z"), { recursive: true });
  const z = join(agent, "projects/z", `${id}.jsonl`);
  const a = join(agent, "projects/a", `${id}.jsonl`);
  const row = (title: string) =>
    JSON.stringify({ type: "custom-title", customTitle: title }) + "\n";
  await writeFile(z, row("old"));
  const source = await createClaudeSessionSource(agent);
  await source.refresh();
  await mkdir(join(agent, "projects/a"));
  await writeFile(a, row("new"));
  expect((await source.refresh()).sessions[0]!.normalized.session.title).toBe("old");
  const fresh = await createClaudeSessionSource(agent);
  expect((await fresh.refresh()).sessions[0]!.normalized.session.title).toBe("new");
  await writeFile(z, JSON.stringify({ type: "user", sessionId: "wrong" }) + "\n");
  expect((await source.refresh()).sessions[0]!.normalized.session.title).toBe("new");
  await rm(a);
  expect((await source.refresh()).sessions).toEqual([]);
});

it("uses bounded Unicode-safe explicit titles and Markdown user titles", async () => {
  const { agent, path } = await createSessionAgent("claude-titles-");
  const source = await createClaudeSessionSource(agent);
  await writeFile(path, JSON.stringify({ type: "system", sessionId: id }) + "\n");
  expect((await source.refresh()).sessions[0]!.normalized.session.title).toBe("Untitled session");
  await writeFile(
    path,
    JSON.stringify({ type: "user", message: { role: "user", content: "intro\n\n# Heading" } }) +
      "\n",
  );
  expect((await source.refresh()).sessions[0]!.normalized.session.title).toBe("Heading");
  await appendFile(path, JSON.stringify({ type: "ai-title", aiTitle: "AI\nsecond" }) + "\n");
  expect((await source.refresh()).sessions[0]!.normalized.session.title).toBe("AI");
  await appendFile(
    path,
    JSON.stringify({ type: "custom-title", customTitle: "x".repeat(79) + "😀tail\nsecond" }) + "\n",
  );
  expect((await source.refresh()).sessions[0]!.normalized.session.title).toBe("x".repeat(79));
});

it("treats a missing projects root as empty without warnings", async () => {
  const agent = await createTempDirectory("claude-empty-");
  expect(await (await createClaudeSessionSource(agent)).refresh()).toMatchObject({
    sessions: [],
    diagnostics: [],
  });
});

it("caps scan diagnostics but continues accepting valid candidates", async () => {
  const agent = await createTempDirectory("claude-scan-limit-");
  for (let index = 0; index < MAX_SESSION_DIAGNOSTICS + 5; index++) {
    const directory = join(agent, "projects", String(index).padStart(2, "0"));
    await mkdir(directory, { recursive: true });
    await writeFile(
      join(directory, `${id}.jsonl`),
      JSON.stringify({ type: "user", sessionId: "wrong" }) + "\n",
    );
  }
  await mkdir(join(agent, "projects/z"));
  await writeFile(join(agent, "projects/z", `${id}.jsonl`), (await lines())[0] + "\n");
  const snapshot = await (await createClaudeSessionSource(agent)).refresh();
  expect(snapshot.diagnostics).toHaveLength(MAX_SESSION_DIAGNOSTICS);
  expect(snapshot.sessions).toHaveLength(1);
});

it("prioritizes decoder diagnostics without hiding identity conflicts across batches", () => {
  const records = [{ ordinal: 2, value: { type: "user", sessionId: "wrong" } }];
  const diagnostics = Array.from({ length: MAX_SESSION_DIAGNOSTICS }, (_, index) => ({
    code: "invalid_jsonl",
    severity: "warning" as const,
    message: "bad",
    ordinal: index + 3,
  }));
  const full = appendClaudeRecords(createClaudeState(id), records, diagnostics);
  const first = appendClaudeRecords(createClaudeState(id), records);
  const incremental = appendClaudeRecords(first, [], diagnostics);
  expect(incremental).toEqual(full);
  expect(full.diagnostics).toHaveLength(MAX_SESSION_DIAGNOSTICS);
  expect(full.diagnostics[0]).toMatchObject({ code: "invalid_jsonl", ordinal: 3 });
  expect(full.identityConflict).toBe(true);
  expect(full.normalizerDiagnostics[0]).toMatchObject({
    code: "conflicting_native_session_id",
    ordinal: 2,
  });
});

it("caches rejected identities, incrementally checks appends and recovers after replacement", async () => {
  const { agent, path } = await createSessionAgent("claude-rejected-cache-");
  const valid = (await lines())[0]!;
  await writeFile(path, valid.replace(id, "aaaaaaaa-2222-4333-8444-555555555555") + "\n");
  const source = await createClaudeSessionSource(agent);
  const rejected = await source.refresh();
  expect(rejected.sessions).toEqual([]);
  expect(rejected.bindings).toEqual([]);
  expect(rejected.diagnostics).toMatchObject([{ code: "conflicting_native_session_id" }]);
  expect(source.lastRefreshTelemetry().fullFiles).toBe(1);
  expect(await source.refresh()).toEqual(rejected);
  expect(source.lastRefreshTelemetry()).toMatchObject({
    fullFiles: 0,
    appendFiles: 0,
    decodeBytes: 0,
  });
  await appendFile(path, valid + "\n");
  expect((await source.refresh()).sessions).toEqual([]);
  expect(source.lastRefreshTelemetry()).toMatchObject({ fullFiles: 0, appendFiles: 1 });
  await writeFile(path, valid + "\n");
  expect((await source.refresh()).sessions).toHaveLength(1);
  expect(source.lastRefreshTelemetry().fullFiles).toBe(1);
});

it("archives Claude history under the same identity and deletes the archive", async () => {
  const { agent, path } = await createSessionAgent("claude-archive-");
  await cp(join(fixture, relative), path);
  const source = await createClaudeSessionSource(agent);
  const manager = new ClaudeSessionManager(agent, new TmuxLauncher());
  const [original] = (await source.refresh()).sessions;
  const subagents = join(path, "..", id, "subagents");
  await mkdir(subagents, { recursive: true });
  await writeFile(join(subagents, "child.jsonl"), "{}");

  const archive = join(agent, "ahub_archived_sessions", `${id}.jsonl`);
  await mkdir(join(archive, ".."));
  await writeFile(archive, "stale history");
  const history = await readFile(path, "utf8");
  await manager.archive(id);
  await manager.archive(id);
  expect(await readFile(archive, "utf8")).toBe(history);
  await expect(readFile(path)).rejects.toMatchObject({ code: "ENOENT" });
  await expect(readFile(join(subagents, "child.jsonl"))).rejects.toMatchObject({ code: "ENOENT" });
  const [archived] = (await source.refresh()).sessions;
  expect(archived).toMatchObject({
    localId: original!.localId,
    normalized: {
      session: { ...original!.normalized.session, archived: true },
      timeline: original!.normalized.timeline,
    },
  });
  await cp(archive, path);
  const conflict = await source.refresh();
  expect(conflict.sessions[0]?.normalized.session.archived).toBe(false);
  expect(conflict.diagnostics).toContainEqual(
    expect.objectContaining({ code: "duplicate_native_session_id" }),
  );
  await manager.delete(id);
  expect((await source.refresh()).sessions).toEqual([]);
  await expect(readFile(archive)).rejects.toMatchObject({ code: "ENOENT" });
});

import { expect, it } from "vitest";

import {
  formatAgyBindingMessage,
  parseAgyBindingMessage,
} from "../../src/server/adapters/agy/binding-message.js";
import {
  appendAgyRecords,
  createAgyState,
} from "../../src/server/adapters/agy/session-normalizer.js";

const operationId = "00000000-0000-4000-8000-000000000001";
const target = { socketPath: "/tmp/agy.sock", sessionName: `ahub-${operationId}` };
const bind = formatAgyBindingMessage(target, "/project", "/work", "Task", operationId);
const nativeId = "11111111-2222-4333-8444-555555555555";

let ordinal = 0;
const user = (text: string, at = "2026-01-01T00:00:01Z") => ({
  ordinal: ++ordinal,
  value: {
    source: "USER_EXPLICIT",
    type: "USER_INPUT",
    created_at: at,
    content: `<USER_REQUEST>\n${text}\n</USER_REQUEST>\n<ADDITIONAL_METADATA>x</ADDITIONAL_METADATA>`,
  },
});
const model = (
  content: string | undefined,
  extra: Record<string, unknown> = {},
  at = "2026-01-01T00:00:02Z",
) => ({
  ordinal: ++ordinal,
  value: { source: "MODEL", type: "PLANNER_RESPONSE", created_at: at, content, ...extra },
});
const system = () => ({
  ordinal: ++ordinal,
  value: { source: "SYSTEM", type: "SYSTEM_MESSAGE", content: "restarted" },
});

it("preserves user request closing tags embedded in a line", () => {
  const markdown = "</USER_REQUEST> at the start\nQuoted </USER_REQUEST> inside a line";
  const state = appendAgyRecords(createAgyState(nativeId), [user(markdown)]);

  expect(state.timeline).toMatchObject([{ role: "user", markdown }]);
});

it("round-trips agy bindings with working and project directories", () => {
  expect(parseAgyBindingMessage(bind, 1)).toEqual({
    attempt: {
      ordinal: 1,
      valid: true,
      ...target,
      operationId,
      projectDirectory: "/project",
      taskName: "Task",
    },
    workingDirectory: "/work",
  });
  const handoff = formatAgyBindingMessage(target, null, null, null);
  expect(parseAgyBindingMessage(handoff, 2)?.attempt).toEqual({
    ordinal: 2,
    valid: true,
    ...target,
  });
});

it("treats invalid binding fields as invalid evidence and ignores unknown payloads", () => {
  const prefix = 'Ignore this message and reply with only "OK". [ahub-bind:';
  expect(parseAgyBindingMessage(`${prefix}{"socketPath":"x","sessionName":"y"}]`, 3)).toEqual({
    attempt: { ordinal: 3, valid: false },
  });
  expect(parseAgyBindingMessage(`${prefix}{"extra":1}]`, 4)).toBeNull();
  expect(parseAgyBindingMessage("hello", 5)).toBeNull();
  expect(() =>
    formatAgyBindingMessage({ ...target, sessionName: "bad" }, null, null, null),
  ).toThrow();
});

it("hides binding exchanges, even across system messages, and keeps real conversation", () => {
  ordinal = 0;
  const bindings: unknown[] = [];
  const state = appendAgyRecords(
    createAgyState(nativeId),
    [
      user(bind),
      model(undefined, { thinking: "hmm" }),
      system(),
      model('"OK."'),
      user("Fix the bug"),
      model("Looking", { tool_calls: [{}] }),
      model("Done"),
    ],
    [],
    (binding) => bindings.push(binding),
  );
  expect(bindings).toHaveLength(1);
  expect(state).toMatchObject({
    project: "/project",
    workingDirectory: "/work",
    taskName: "Task",
    firstUser: "Fix the bug",
    createdAt: "2026-01-01T00:00:01Z",
  });
  expect(
    state.timeline.map((item) => item.kind === "message" && [item.role, item.phase, item.markdown]),
  ).toEqual([
    ["user", null, "Fix the bug"],
    ["assistant", "update", "Looking"],
    ["assistant", "response", "Done"],
  ]);
});

it("releases non-OK replies after a binding and falls back to the project as working directory", () => {
  ordinal = 0;
  const state = appendAgyRecords(createAgyState(nativeId), [
    user(formatAgyBindingMessage(target, "/project", null, null)),
    model("Sure, hello"),
    user(formatAgyBindingMessage(target, "/project", null, null)),
    model('"OK".'),
    user(formatAgyBindingMessage(target, "/project", null, null)),
    model("\"OK'"),
  ]);
  expect(state.workingDirectory).toBe("/project");
  expect(state.timeline.map((item) => item.kind === "message" && item.markdown)).toEqual([
    "Sure, hello",
    "\"OK'",
  ]);
  expect(state.firstUser).toBeNull();
});

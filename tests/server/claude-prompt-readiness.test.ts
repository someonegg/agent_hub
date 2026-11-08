import { expect, it } from "vitest";

import { claudePromptPosition } from "../../src/server/adapters/claude/prompt-readiness.js";

const content = "Welcome\n\n❯\u00a0\n\nStatus";

it.each(["", " ", "\t\u00a0\u3000"])(
  "accepts an empty prompt with horizontal whitespace: %j",
  (whitespace) => {
    expect(claudePromptPosition({ content: `❯${whitespace}`, cursorX: 2, cursorY: 0 })).toBe(0);
  },
);

it.each(["\u200b", "\tExisting draft", "\rtext", "\u2028text", "\u2029text"])(
  "rejects prompt content that is not horizontal whitespace: %j",
  (suffix) => {
    expect(claudePromptPosition({ content: `❯${suffix}`, cursorX: 2, cursorY: 0 })).toBeNull();
  },
);

// The two coordinate ranges are independent; corners and center cover their boundaries.
it.each([
  { cursorX: 1, cursorY: 0 },
  { cursorX: 5, cursorY: 0 },
  { cursorX: 3, cursorY: 2 },
  { cursorX: 1, cursorY: 4 },
  { cursorX: 5, cursorY: 4 },
])("allows cursor drift within the prompt rectangle: %j", (cursor) => {
  expect(claudePromptPosition({ content, ...cursor })).toBe(2);
});

it.each([
  { content, cursorX: 0, cursorY: 2 },
  { content, cursorX: 6, cursorY: 2 },
  { content: "\n" + content, cursorX: 2, cursorY: 0 },
  { content, cursorX: 2, cursorY: 5 },
  { content: "❯\n\n\nUpdate available!", cursorX: 2, cursorY: 3 },
  null,
])("rejects menus, drafts and a cursor outside the rectangle: %j", (snapshot) => {
  expect(claudePromptPosition(snapshot)).toBeNull();
});

it("does not reject a usable prompt merely because an update banner is present", () => {
  expect(
    claudePromptPosition({
      content: "Welcome\n❯ \nUpdate available! Run: brew upgrade claude-code",
      cursorX: 2,
      cursorY: 1,
    }),
  ).toBe(1);
});

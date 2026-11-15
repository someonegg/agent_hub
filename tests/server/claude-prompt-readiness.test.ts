import { expect, it } from "vitest";

import { claudePromptPosition } from "../../src/server/adapters/claude/prompt-readiness.js";

const content = "Welcome\n\n❯\u00a0\n\nStatus";

it("accepts empty prompts with horizontal whitespace", () => {
  for (const whitespace of ["", " ", "\t\u00a0\u3000"]) {
    expect(
      claudePromptPosition({ content: `❯${whitespace}`, cursorX: 2, cursorY: 0 }),
      JSON.stringify(whitespace),
    ).toBe(0);
  }
});

it("rejects drafts, invisible content and vertical whitespace", () => {
  for (const suffix of ["\u200b", "\tExisting draft", "\rtext", "\u2028text", "\u2029text"]) {
    expect(
      claudePromptPosition({ content: `❯${suffix}`, cursorX: 2, cursorY: 0 }),
      JSON.stringify(suffix),
    ).toBeNull();
  }
});

// The two coordinate ranges are independent; corners and center cover their boundaries.
it("accepts the corners and center of the prompt rectangle", () => {
  for (const cursor of [
    { cursorX: 1, cursorY: 0 },
    { cursorX: 5, cursorY: 0 },
    { cursorX: 3, cursorY: 2 },
    { cursorX: 1, cursorY: 4 },
    { cursorX: 5, cursorY: 4 },
  ]) {
    expect(claudePromptPosition({ content, ...cursor }), JSON.stringify(cursor)).toBe(2);
  }
});

it("rejects missing prompts and cursors outside the prompt rectangle", () => {
  for (const snapshot of [
    { content, cursorX: 0, cursorY: 2 },
    { content, cursorX: 6, cursorY: 2 },
    { content: "\n" + content, cursorX: 2, cursorY: 0 },
    { content, cursorX: 2, cursorY: 5 },
    { content: "❯\n\n\nUpdate available!", cursorX: 2, cursorY: 3 },
    null,
  ]) {
    expect(claudePromptPosition(snapshot), JSON.stringify(snapshot)).toBeNull();
  }
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

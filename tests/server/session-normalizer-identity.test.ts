import { describe, expect, it } from "vitest";

import { MAX_SESSION_TITLE_CHARS } from "../../src/server/domain/session-text.js";
import { normalizeDecoded, resolveIdentity } from "./session-normalizer.fixtures.js";
import { decodedRollout, normalizeRecords } from "./session-normalizer.fixtures.js";

describe("session identity and recovery", () => {
  it("bounds JSONL titles to the first non-empty line", () => {
    const longLine = "A JSONL title that should stay compact ".repeat(8);
    const normalized = normalizeRecords("long-title-session", [], {
      threadId: "long-title-session",
      title: ` \n\n ${longLine}\nIgnored title continuation`,
    });

    expect(normalized.session.title).toBe(longLine.trim().slice(0, MAX_SESSION_TITLE_CHARS));
    expect(normalized.session.title).toHaveLength(MAX_SESSION_TITLE_CHARS);
    expect(normalized.session.title).not.toContain("\n");
  });

  it("falls back to the first user message and record timestamps", () => {
    const decoded = decodedRollout("fallback-session", [
      {
        ordinal: 1,
        value: {
          timestamp: "2026-07-28T12:00:00.000Z",
          type: "response_item",
          payload: {
            type: "message",
            role: "user",
            content: [{ type: "input_text", text: "Fallback title from user" }],
          },
        },
      },
      {
        ordinal: 2,
        value: {
          timestamp: "2026-07-28T12:00:00.000Z",
          type: "event_msg",
          payload: {
            type: "user_message",
            message: "Fallback title from user",
          },
        },
      },
      {
        ordinal: 3,
        value: {
          timestamp: "2026-07-28T12:00:05.000Z",
          type: "event_msg",
          payload: { type: "token_count" },
        },
      },
    ]);
    const normalized = normalizeDecoded(decoded, resolveIdentity(decoded));

    expect(normalized.session).toEqual(
      expect.objectContaining({
        title: "Fallback title from user",
        createdAt: "2026-07-28T12:00:00.000Z",
        updatedAt: "2026-07-28T12:00:05.000Z",
      }),
    );
  });

  it("chooses filename-matching metadata when duplicate metadata records exist", () => {
    const decoded = decodedRollout("selected", [
      { ordinal: 1, value: { type: "session_meta", payload: { id: "other", cwd: "/other" } } },
      {
        ordinal: 2,
        value: { type: "session_meta", payload: { id: "selected", cwd: "/selected" } },
      },
    ]);
    const normalized = normalizeDecoded(decoded, resolveIdentity(decoded));
    expect(normalized.session.workingDirectory).toBe("/selected");
  });
});

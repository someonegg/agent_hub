import { expect, it } from "vitest";

import { SessionCache, SessionMessageCache } from "../../src/client/state/session-cache";
import { firstPage, SESSION_ID } from "./session.fixtures";

const page = { ...firstPage, items: [] };
const pageBytes = JSON.stringify(page).length * 2;

it("evicts by last open across nodes without promoting background writes", () => {
  const messages = new SessionMessageCache(pageBytes * 2);
  const local = new SessionCache(messages, "local");
  const remote = new SessionCache(messages, "remote");

  local.storeMessages(SESSION_ID, page);
  remote.storeMessages(SESSION_ID, page);
  expect(local.messages(SESSION_ID, true)).toBe(page);
  remote.storeMessages(SESSION_ID, { ...page });
  local.storeMessages("another-session", page);

  expect(remote.messages(SESSION_ID)).toBeNull();
  expect(local.messages(SESSION_ID)).toBe(page);
  expect(local.messages("another-session")).toBe(page);
});

it("discards an oversized history without evicting other histories", () => {
  const cache = new SessionCache(new SessionMessageCache(pageBytes * 2), "local");

  cache.storeMessages(SESSION_ID, page);
  cache.storeMessages("another-session", page);
  cache.storeMessages(SESSION_ID, {
    ...page,
    session: { ...page.session, title: "a".repeat(pageBytes) },
  });

  expect(cache.messages(SESSION_ID)).toBeNull();
  expect(cache.messages("another-session")).toBe(page);
});

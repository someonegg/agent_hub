import { expect, it } from "vitest";

import { RequestBodyError } from "../../src/server/http/request-body.js";
import {
  parseKeysBody,
  parseMessageBody,
} from "../../src/server/http/session-interaction-routes.js";
import { MessageValidationError } from "../../src/server/interaction/message.js";
import { INTERACTION_KEYS } from "../../src/shared/api-contract.js";

it("requires a string message and a boolean idle requirement", () => {
  for (const body of [{ message: 1 }, { message: "ok", requireIdle: "yes" }]) {
    expect(() => parseMessageBody(body), JSON.stringify(body)).toThrow(RequestBodyError);
    expect(() => parseMessageBody(body), JSON.stringify(body)).toThrow(
      "body must contain only a string message field",
    );
  }
});
it("validates message bytes after structure without changing the transmitted text", () => {
  const body = { message: "a\r\nb", requireIdle: false };
  expect(parseMessageBody(body)).toEqual(body);
  expect(parseMessageBody({ message: "a".repeat(262_144) }).message).toHaveLength(262_144);
  expect(() => parseMessageBody({ message: "a".repeat(262_145) })).toThrow(MessageValidationError);
  expect(() => parseMessageBody({ message: " \n " })).toThrow(MessageValidationError);
  expect(() => parseMessageBody({ message: " ", extra: true })).toThrow(RequestBodyError);
});
it("rejects invalid keys structure, length and idle restrictions", () => {
  for (const body of [
    { keys: "enter" },
    { keys: ["enter"], extra: true },
    { keys: Array.from({ length: 65 }, () => "left") },
    { keys: ["interrupt"], requireIdle: true },
  ]) {
    expect(() => parseKeysBody(body), JSON.stringify(body)).toThrow(RequestBodyError);
  }
});
it("accepts all supported keys and the sequence boundary with optional idle requirements", () => {
  expect(parseKeysBody({ keys: [...INTERACTION_KEYS] })).toEqual({ keys: [...INTERACTION_KEYS] });
  const body = { keys: Array.from({ length: 64 }, () => "left"), requireIdle: true };
  expect(parseKeysBody(body)).toEqual(body);
  expect(parseKeysBody({ keys: ["interrupt"], requireIdle: false })).toEqual({
    keys: ["interrupt"],
    requireIdle: false,
  });
});
it("checks keys structure before sequence contents and idle restrictions", () => {
  expect(() => parseKeysBody({ keys: ["unknown"], requireIdle: "yes" })).toThrow(
    "body must contain only a keys array",
  );
  expect(() => parseKeysBody({ keys: ["unknown", "interrupt"], requireIdle: true })).toThrow(
    "keys must contain 1-64 supported interaction keys",
  );
});

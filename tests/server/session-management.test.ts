import { expect, it } from "vitest";

import { exitSteps, interruptSteps } from "../../src/server/adapters/shared/session-management.js";

it("interrupts with Ctrl+U then Escape after the configured delay", () => {
  expect(interruptSteps()).toEqual([
    { keys: ["C-u"], delayMs: 0 },
    { keys: ["Escape"], delayMs: 100 },
  ]);
});

it("requests exit with two Ctrl+C bursts at the configured delays", () => {
  expect(exitSteps()).toEqual([
    {
      delayMs: 0,
      steps: [
        { keys: ["C-c"], delayMs: 0 },
        { keys: ["C-c"], delayMs: 200 },
      ],
    },
    {
      delayMs: 2400,
      steps: [
        { keys: ["C-c"], delayMs: 0 },
        { keys: ["C-c"], delayMs: 150 },
      ],
    },
  ]);
});

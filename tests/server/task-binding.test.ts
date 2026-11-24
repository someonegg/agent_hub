import { execFileSync } from "node:child_process";

import { expect, it } from "vitest";

import {
  codexBindingAttemptsFrom,
  codexBindingCommand,
} from "../../src/server/adapters/codex/interaction-parser.js";

it("round trips quoted task names without shell evaluation", () => {
  const task = "跨项目 'quoted' $(printf unsafe) `command`";
  const command = codexBindingCommand(undefined, "/project", task).slice(2);
  const output = execFileSync("bash", ["-c", command], {
    encoding: "utf8",
    env: {
      ...process.env,
      TMUX: "/tmp/task-test-socket,123,0",
      AHUB_TMUX_SESSION_NAME: "ahub-00000000-0000-0000-0000-000000000007",
    },
  });
  expect(bindingAttempts(output)).toEqual([
    {
      ordinal: 1,
      valid: true,
      socketPath: "/tmp/task-test-socket",
      sessionName: "ahub-00000000-0000-0000-0000-000000000007",
      projectDirectory: "/project",
      taskName: task,
    },
  ]);
});

it("ignores malformed and disallowed task fields without invalidating bindings", () => {
  for (const task of ["not-json", JSON.stringify("a>b")]) {
    const output = `AHUB_TMUX_BIND_V3\n/tmp/socket\nahub-00000000-0000-0000-0000-000000000007\n\n/project\n${task}\n`;
    expect(bindingAttempts(output, 9), JSON.stringify(task)).toEqual([
      {
        ordinal: 9,
        valid: true,
        socketPath: "/tmp/socket",
        sessionName: "ahub-00000000-0000-0000-0000-000000000007",
        projectDirectory: "/project",
      },
    ]);
  }
});

function bindingAttempts(output: string, ordinal = 1) {
  return codexBindingAttemptsFrom({
    ordinal,
    value: {
      type: "response_item",
      payload: {
        type: "message",
        role: "user",
        content: [
          {
            type: "input_text",
            text: `<user_shell_command>\n${output}</user_shell_command>`,
          },
        ],
      },
    },
  });
}

it("rejects shell output delimiters before generating commands", () => {
  expect(() =>
    codexBindingCommand(undefined, "/project", "Fix </user_shell_command> parsing"),
  ).toThrow("Task name");
});

import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { forbiddenDependencies } from "../../scripts/check-architecture.js";

const serverDirectory = resolve("src/server");
const codexDirectory = resolve(serverDirectory, "adapters/codex");
const apiDirectory = resolve(serverDirectory, "api");
const apiContract = resolve("src/shared/api-contract.js");

describe("architecture dependency scanner", () => {
  it.each([
    'import "../adapters/codex/session-manager.js";',
    'const adapter = import( /* adapter */ "../adapters/codex/session-manager.js");',
    'type Manager = import("../adapters/codex/session-manager.js").CodexSessionManager;',
  ])("detects Codex dependency syntax: %s", (source) => {
    expect(
      forbiddenDependencies(resolve(serverDirectory, "application/example.ts"), source, [
        codexDirectory,
      ]),
    ).toEqual([resolve(codexDirectory, "session-manager.js")]);
  });

  it("resolves relative API paths without matching comments, strings or sibling directories", () => {
    const file = resolve(serverDirectory, "repository/example.ts");
    expect(
      forbiddenDependencies(file, 'import { map } from "../api/other-mapper.js";', [apiDirectory]),
    ).toEqual([resolve(apiDirectory, "other-mapper.js")]);
    expect(
      forbiddenDependencies(
        file,
        `
      // import "../api/other-mapper.js";
      const example = 'import "../api/other-mapper.js";';
      import "../api-extra/example.js";
    `,
        [apiDirectory],
      ),
    ).toEqual([]);
  });

  it("normalizes TypeScript extensions in API contract dependencies", () => {
    expect(
      forbiddenDependencies(
        resolve(serverDirectory, "repository/example.ts"),
        'import type { ApiError } from "../../shared/api-contract.ts";',
        [apiContract],
      ),
    ).toHaveLength(1);
  });
});

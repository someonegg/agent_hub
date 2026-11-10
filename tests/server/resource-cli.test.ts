import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

import { expect, it } from "vitest";

import { CommandError } from "../../src/server/cli/command-error.js";
import { parseResourceArguments, validateResourcePublish } from "../../src/server/cli/resource.js";

const exec = promisify(execFile);
it.each([
  ["page", "list", ["--unknown"]],
  ["page", "list", ["--home-dir"]],
  ["diff", "publish", []],
  ["page", "nonsense", []],
] as const)("rejects invalid resource arguments: %s %s %j", (resource, action, args) => {
  expect(() => parseResourceArguments(resource, action, [...args])).toThrow(CommandError);
  expect(() => parseResourceArguments(resource, action, [...args])).toThrow(
    expect.objectContaining({ code: "invalid_arguments" }),
  );
});

it("wires resource errors to JSON output", async () => {
  const result = await exec(process.execPath, [
    "--import",
    "tsx",
    "src/server/cli/main.ts",
    "page",
    "list",
    "--unknown",
    "--json",
  ]).catch((error) => error);
  expect(result.code).toBe(1);
  expect(result.stderr).toBe("");
  expect(JSON.parse(result.stdout).error.code).toBe("invalid_arguments");
});

// Check representative action policies directly; shared parsing rejects restricted options.
// The process smoke above owns JSON output wiring; cli-output owns stream formatting.
const invalidOptions = [
  { resource: "page", action: "list", option: "project" },
  { resource: "page", action: "delete", option: "name" },
  { resource: "diff", action: "publish", option: "project" },
];
it.each(invalidOptions)("rejects inapplicable options: %j", ({ resource, action, option }) => {
  const args = [...(action === "list" ? [] : ["/missing-source"]), `--${option}`, "value"];
  expect(() => parseResourceArguments(resource, action, args)).toThrow(
    `Option --${option} is not supported for ${resource} ${action}`,
  );
  expect(() => parseResourceArguments(resource, action, args)).toThrow(CommandError);
});

it.each(["page", "diff"])(
  "accepts legal %s options through publish, list and delete",
  async (resource) => {
    const root = await mkdtemp(join(tmpdir(), "resource-cli-"));
    const agent = join(root, "agent");
    const source = join(root, "source");
    const runText = async (...args: string[]) => {
      const result = await exec(process.execPath, [
        "--import",
        "tsx",
        "src/server/cli/main.ts",
        resource,
        ...args,
        "--home-dir",
        agent,
      ]);
      expect(result.stderr).toBe("");
      return result.stdout;
    };
    const run = async (...args: string[]) => JSON.parse(await runText(...args, "--json"));
    try {
      await mkdir(source);
      await writeFile(join(source, "index.html"), "<h1>Test</h1>");
      const file = join(root, "test.diff");
      await writeFile(file, "diff --git a/test b/test\n");
      const title = "Example\n中文👩🏽‍💻";
      const published = await run(
        "publish",
        resource === "page" ? source : file,
        ...(resource === "page" ? ["--project", root, "--name", "example"] : []),
        "--title",
        title,
      );
      expect(published.title).toBe(title);
      if (resource === "page") expect(published.name).toBe("example");
      expect(await run("list")).toEqual([published]);
      // The output unit tests own Unicode cell widths; this smoke checks resource field wiring.
      const lines = (await runText("list")).trimEnd().split("\n");
      expect(lines).toHaveLength(2);
      expect(lines[0]).toMatch(
        resource === "page" ? /^ID +PROJECT +TITLE +URL$/ : /^ID +TITLE +URL$/,
      );
      expect(lines[1]).toContain("Example 中文👩🏽‍💻");
      expect(lines[1]!.endsWith(published.url)).toBe(true);
      if (resource === "page") expect(lines[1]).toContain(root);
      expect(await run("delete", published.id)).toEqual({ id: published.id, deleted: true });
      expect(await run("list")).toEqual([]);
      expect(await runText("list")).toBe(
        resource === "page"
          ? "ID  PROJECT  TITLE  URL\nNo pages.\n"
          : "ID  TITLE  URL\nNo diffs.\n",
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
);

it("preserves help before checking inapplicable options", () => {
  expect(
    parseResourceArguments("diff", "list", ["--project", "unused", "--help", "--json"]).help,
  ).toBe(true);
});

it("parses publication options and requires a project for pages", () => {
  expect(
    parseResourceArguments("page", "publish", [
      "source",
      "--project",
      "project",
      "--title",
      "Title",
      "--json",
    ]),
  ).toMatchObject({
    help: false,
    positionals: [resolve("source")],
    values: { project: resolve("project"), title: "Title", json: true },
  });
  expect(() => validateResourcePublish("page", undefined)).toThrow(
    "page publish requires --project",
  );
  expect(validateResourcePublish("page", ".")).toBeUndefined();
  expect(validateResourcePublish("diff", undefined)).toBeUndefined();
});
it("rejects unknown top-level commands", async () => {
  const result = await exec(process.execPath, [
    "--import",
    "tsx",
    "src/server/cli/main.ts",
    "unknown",
    "--json",
  ]).catch((error) => error);
  expect(result.code).toBe(1);
  expect(result.stderr).toBe("");
  expect(JSON.parse(result.stdout).error).toMatchObject({
    code: "invalid_arguments",
    message: expect.stringContaining("Unknown command: unknown"),
  });
});

it.each([["~/project with spaces", join(homedir(), "project with spaces")]])(
  "normalizes resource publication paths: %s",
  (input, expected) => {
    expect(parseResourceArguments("page", "publish", [input, "--project", input])).toMatchObject({
      positionals: [expected],
      values: { project: expected },
    });
    expect(parseResourceArguments("diff", "publish", [input])).toMatchObject({
      positionals: [expected],
    });
  },
);

it.each([
  ["page", ["", "--project", "/project"]],
  ["page", ["/source", "--project", "   "]],
  ["diff", ["   "]],
] as const)("rejects empty publication paths: %s %j", (resource, args) => {
  expect(() => parseResourceArguments(resource, "publish", [...args])).toThrow(
    expect.objectContaining({ code: "invalid_arguments" }),
  );
});

it("preserves delete IDs without path normalization", () => {
  expect(parseResourceArguments("page", "delete", ["artifact-id"]).positionals).toEqual([
    "artifact-id",
  ]);
});

import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";

import { parse } from "@babel/parser";

const serverDirectory = resolve("src/server");
const claudeDirectory = resolve(serverDirectory, "adapters/claude");
const codexDirectory = resolve(serverDirectory, "adapters/codex");
const apiDirectory = resolve(serverDirectory, "api");
const apiContract = resolve("src/shared/api-contract.js");
const tmuxImplementations = ["tmux-service", "tmux-launcher"].map((name) =>
  resolve(serverDirectory, `interaction/${name}.js`),
);

export async function checkArchitecture() {
  const files = (await typescriptFiles(serverDirectory)).filter((file) => {
    const serverRelativePath = relative(serverDirectory, file);
    return (
      !serverRelativePath.startsWith(`adapters${sep}`) && serverRelativePath !== "create-hub.ts"
    );
  });
  await assertIndependent(files, [codexDirectory, claudeDirectory]);
  await assertIndependent(
    [
      resolve(codexDirectory, "codex-session-source.ts"),
      resolve(claudeDirectory, "claude-session-source.ts"),
      ...(await typescriptFiles(resolve(serverDirectory, "repository"))),
    ],
    [resolve(serverDirectory, "interaction/pane-binding-manager.js")],
  );
  await assertIndependent(await typescriptFiles(claudeDirectory), [codexDirectory]);
  await assertIndependent(await typescriptFiles(codexDirectory), [claudeDirectory]);
  await assertIndependent(await typescriptFiles(resolve(serverDirectory, "repository")), [
    apiContract,
    apiDirectory,
  ]);
  await assertIndependent(await typescriptFiles(resolve(serverDirectory, "domain")), [apiContract]);
  await assertIndependent(
    await typescriptFiles(resolve(serverDirectory, "http")),
    tmuxImplementations,
  );
}

async function assertIndependent(files: string[], forbidden: string[]) {
  for (const file of files) {
    assert.deepEqual(
      forbiddenDependencies(file, await readFile(file, "utf8"), forbidden),
      [],
      file,
    );
  }
}

export function forbiddenDependencies(file: string, source: string, forbidden: string[]): string[] {
  const dependencies: string[] = [];
  function visit(value: unknown): void {
    if (value === null || typeof value !== "object") return;
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    const node = value as Record<string, unknown>;
    let target: unknown;
    switch (node.type) {
      case "ImportDeclaration":
      case "ExportNamedDeclaration":
      case "ExportAllDeclaration":
      case "ImportExpression":
        target = node.source;
        break;
      case "TSImportType":
        target = node.argument;
        break;
      case "TSExternalModuleReference":
        target = node.expression;
        break;
    }
    if (
      target !== null &&
      typeof target === "object" &&
      "value" in target &&
      typeof target.value === "string" &&
      target.value.startsWith(".")
    ) {
      const dependency = resolve(dirname(file), target.value);
      if (
        forbidden.some(
          (path) =>
            modulePath(dependency) === modulePath(path) || dependency.startsWith(path + sep),
        )
      ) {
        dependencies.push(dependency);
      }
    }
    Object.values(node).forEach(visit);
  }
  visit(
    parse(source, { sourceType: "module", plugins: ["typescript"], createImportExpressions: true })
      .program,
  );
  return dependencies;
}

function modulePath(path: string): string {
  return path.replace(/\.(?:[cm]?[jt]sx?)$/, "");
}

async function typescriptFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(
    entries.map((entry) => {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) return typescriptFiles(path);
      return entry.isFile() && entry.name.endsWith(".ts") ? [path] : [];
    }),
  );
  return files.flat();
}

if (import.meta.url === pathToFileURL(resolve(process.argv[1] ?? "")).href) {
  await checkArchitecture();
}

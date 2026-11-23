import { readFile } from "node:fs/promises";
import { join } from "node:path";

export async function readLaunchEnvironment(directory: string): Promise<Record<string, string>> {
  let source: string;
  try {
    source = (await readFile(join(directory, ".ahub-env"), "utf8")).replace(/^\uFEFF/, "");
  } catch {
    return {};
  }
  if (source.includes("\0")) return {};

  // Match complete records so any malformed line invalidates the entire file.
  const record =
    /[ \t]*(?:(?:export[ \t]+)?([A-Za-z_][A-Za-z0-9_]*)[ \t]*=[ \t]*(?:"([^"]*)"|'([^']*)'|([^ \t"'#\r\n][^#\r\n]*)?)[ \t]*)?(?:#[^\r\n]*)?(?:\r?\n|$)/y;
  const entries = new Map<string, string>();
  while (record.lastIndex < source.length) {
    const match = record.exec(source);
    if (!match) return {};
    const [, name, doubleQuoted, singleQuoted, unquoted] = match;
    if (name) entries.set(name, doubleQuoted ?? singleQuoted ?? unquoted?.trim() ?? "");
  }
  return Object.fromEntries(entries);
}

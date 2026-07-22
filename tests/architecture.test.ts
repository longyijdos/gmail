import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { describe, expect, test } from "vitest";

const SOURCE_ROOT = join(import.meta.dirname, "../src");
const TEST_ROOT = import.meta.dirname;

describe("module boundaries", () => {
  test("every top-level module exposes an index barrel", async () => {
    const entries = await readdir(SOURCE_ROOT, { withFileTypes: true });
    const modules = entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);

    for (const module of modules) {
      expect(existsSync(join(SOURCE_ROOT, module, "index.ts"))).toBe(true);
    }
  });

  test("aliased imports do not bypass module barrels", async () => {
    const violations: string[] = [];
    for (const file of await listTypeScriptFiles(SOURCE_ROOT)) {
      const source = await readFile(file, "utf8");
      for (const match of source.matchAll(/["'](@\/[^/"']+\/[^"']+)["']/g)) {
        violations.push(`${relative(SOURCE_ROOT, file)}: ${match[1]}`);
      }
    }

    expect(violations).toEqual([]);
  });

  test("tests mutate process globals only through support fixtures", async () => {
    const violations: string[] = [];
    for (const file of await listTypeScriptFiles(TEST_ROOT)) {
      const testPath = relative(TEST_ROOT, file);
      if (testPath.startsWith("support/")) continue;
      const source = await readFile(file, "utf8");
      if (/globalThis\.fetch\s*=/.test(source)) violations.push(`${testPath}: globalThis.fetch`);
      if (/(?:process\.env\.GML_HOME\s*=|delete\s+process\.env\.GML_HOME)/.test(source)) {
        violations.push(`${testPath}: process.env.GML_HOME`);
      }
    }

    expect(violations).toEqual([]);
  });
});

async function listTypeScriptFiles(directory: string): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await listTypeScriptFiles(path)));
    else if (entry.isFile() && entry.name.endsWith(".ts")) files.push(path);
  }
  return files.sort();
}

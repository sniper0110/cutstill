import { execFile } from "node:child_process";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { getToolsCatalog } from "../src/lib/tools/index.js";

const execFileAsync = promisify(execFile);

const FORBIDDEN = ["pycad", "download guide below", "youtube.com", "youtu.be"];

async function walkFiles(dir: string, acc: string[] = []): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === ".git" || entry.name === "sessions") continue;
      await walkFiles(full, acc);
    } else if (/\.(ts|tsx|md|json|mjs|cjs)$/.test(entry.name) && entry.name !== "leak.test.ts") {
      acc.push(full);
    }
  }
  return acc;
}

describe("no brand / kit leak", () => {
  it("catalog, help, and shipped source do not contain forbidden copy", async () => {
    const catalog = JSON.stringify(getToolsCatalog()).toLowerCase();
    for (const needle of FORBIDDEN) {
      expect(catalog, `catalog leaked ${needle}`).not.toContain(needle);
    }
    expect(catalog).not.toContain("videoid");
    expect(catalog).not.toContain("title_card");
    expect(catalog).not.toContain("graphic.upsert");
    expect(catalog).not.toContain("encode.preview");

    const { stdout } = await execFileAsync("npx", ["tsx", "src/cli/cutstill.ts", "--help"], { timeout: 20_000 });
    const help = stdout.toLowerCase();
    for (const needle of FORBIDDEN) {
      expect(help, `help leaked ${needle}`).not.toContain(needle);
    }

    const files = [
      ...(await walkFiles(path.resolve("src"))),
      path.resolve("README.md"),
      ...(await walkFiles(path.resolve("scripts"))),
    ];
    for (const file of files) {
      const info = await stat(file).catch(() => null);
      if (!info?.isFile()) continue;
      const text = (await readFile(file, "utf8")).toLowerCase();
      for (const needle of FORBIDDEN) {
        expect(text, `${file} leaked ${needle}`).not.toContain(needle);
      }
    }
  });
});

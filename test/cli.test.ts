import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { V1_TOOL_NAMES } from "../src/lib/tools/index.js";
import { ensureStandInMp4, tempSessionsRoot } from "./helpers.js";

const execFileAsync = promisify(execFile);
const CLI = path.resolve("src/cli/cutstill.ts");

function parseJsonPayload(stdout: string): unknown {
  const trimmed = stdout.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.lastIndexOf("{");
    if (start >= 0) return JSON.parse(trimmed.slice(start));
    throw new Error(`CLI stdout was not JSON: ${trimmed.slice(0, 400)}`);
  }
}

async function cutstill(
  args: string[],
  env: NodeJS.ProcessEnv = {},
): Promise<{ code: number; json: unknown; stdout: string; stderr: string }> {
  try {
    const result = await execFileAsync("npx", ["tsx", CLI, ...args], {
      env: { ...process.env, ...env, CUTSTILL_SKIP_NETWORK: "1" },
      timeout: 90_000,
    });
    const stdout = result.stdout.toString();
    return { code: 0, json: parseJsonPayload(stdout), stdout, stderr: result.stderr.toString() };
  } catch (error) {
    const err = error as { stdout?: string | Buffer; stderr?: string | Buffer; code?: number };
    const stdout = String(err.stdout ?? "");
    const stderr = String(err.stderr ?? "");
    let json: unknown = null;
    try {
      json = parseJsonPayload(stdout);
    } catch {
      json = { parseError: stdout, stderr };
    }
    return { code: typeof err.code === "number" ? err.code : 1, json, stdout, stderr };
  }
}

describe("CLI schema and --json bind", () => {
  it("schema dumps cutstill.tools.v1", async () => {
    const result = await cutstill(["schema"]);
    expect(result.code).toBe(0);
    const catalog = result.json as { schema: string; tools: Array<{ name: string }> };
    expect(catalog.schema).toBe("cutstill.tools.v1");
    expect(catalog.tools.map((tool) => tool.name)).toEqual([...V1_TOOL_NAMES]);
  });

  it("help lists the four tools and the still loop", async () => {
    const { stdout } = await execFileAsync("npx", ["tsx", CLI, "--help"], { timeout: 20_000 });
    expect(stdout).toMatch(/cutstill\.tools\.v1/);
    expect(stdout).toMatch(/session\.create/);
    expect(stdout).toMatch(/comp\.upsert/);
    expect(stdout).toMatch(/render\.still/);
    expect(stdout).toMatch(/media\.transcribe/);
    expect(stdout).toMatch(/see the PNG/);
    expect(stdout).not.toMatch(/ave direct/);
    expect(stdout).not.toMatch(/graphic\.upsert/);
  });

  it("round-trips session.create → session.get → media.transcribe with --json", async () => {
    const root = await tempSessionsRoot("cutstill-cli-");
    const sourcePath = await ensureStandInMp4();
    const env = { CUTSTILL_SESSIONS_ROOT: root };
    const created = await cutstill(["session.create", "--json", JSON.stringify({ sourcePath })], env);
    expect(created.code).toBe(0);
    const sessionId = (created.json as { sessionId: string }).sessionId;
    expect(sessionId).toBeTruthy();

    const got = await cutstill(["session.get", "--json", JSON.stringify({ sessionId })], env);
    expect(got.code).toBe(0);
    expect((got.json as { sessionId: string }).sessionId).toBe(sessionId);

    const transcript = await cutstill(["media.transcribe", "--json", JSON.stringify({ sessionId })], env);
    expect(transcript.code).toBe(0);
    expect(((transcript.json as { words: unknown[] }).words ?? []).length).toBeGreaterThanOrEqual(2);
  });

  it("CLI render.still prints path metadata and does not inline pixels", async () => {
    const root = await tempSessionsRoot("cutstill-cli-still-");
    const sourcePath = await ensureStandInMp4();
    const env = { CUTSTILL_SESSIONS_ROOT: root };
    const created = await cutstill(["session.create", "--json", JSON.stringify({ sourcePath })], env);
    const sessionId = (created.json as { sessionId: string }).sessionId;
    const still = await cutstill(["render.still", "--json", JSON.stringify({ sessionId, tSec: 0.3 })], env);
    expect(still.code, `render.still failed: ${still.stdout}\n${still.stderr}`).toBe(0);
    const payload = still.json as { path: string; tSec: number; imageBase64?: string };
    expect(existsSync(payload.path)).toBe(true);
    expect(payload.tSec).toBe(0.3);
    expect(payload.imageBase64).toBeUndefined();
    expect(still.stdout).not.toMatch(/imageBase64/);
    expect(still.stdout.length).toBeLessThan(8_000);
  }, 90_000);

  it("unknown tool exits 1 with { error }", async () => {
    const result = await cutstill(["not.a.tool", "--json", "{}"]);
    expect(result.code).toBe(1);
    expect((result.json as { error: { code: string } }).error.code).toBe("UNKNOWN_TOOL");
  });
});

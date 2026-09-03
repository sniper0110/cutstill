import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { V1_TOOL_NAMES } from "../src/lib/tools/index.js";
import { FACE_FIXTURE } from "../scripts/generate-fixtures.js";
import { ensureFaceFixtureMp4, ensureStandInMp4, tempSessionsRoot } from "./helpers.js";

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

  it("help lists the tools and the still loop", async () => {
    const { stdout } = await execFileAsync("npx", ["tsx", CLI, "--help"], { timeout: 20_000 });
    expect(stdout).toMatch(/cutstill\.tools\.v1/);
    expect(stdout).toMatch(/session\.create/);
    expect(stdout).toMatch(/comp\.upsert/);
    expect(stdout).toMatch(/render\.still/);
    expect(stdout).toMatch(/render\.window/);
    expect(stdout).toMatch(/render\.publish/);
    expect(stdout).toMatch(/media\.transcribe/);
    expect(stdout).toMatch(/timeline\.cut/);
    expect(stdout).toMatch(/timeline\.keep/);
    expect(stdout).toMatch(/timeline\.speed/);
    expect(stdout).toMatch(/timeline\.layout/);
    expect(stdout).toMatch(/fal\.models/);
    expect(stdout).toMatch(/fal\.generate/);
    expect(stdout).toMatch(/fal\.status/);
    expect(stdout).toMatch(/media\.face/);
    expect(stdout).toMatch(/timeline\.cropFromTalent/);
    expect(stdout).not.toMatch(/fal\.attach/);
    expect(stdout).toMatch(/mode":"stack"/);
    expect(stdout).toMatch(/captions/);
    expect(stdout).toMatch(/1080×1920|1080x1920/);
    expect(stdout).toMatch(/see the PNG/);
    expect(stdout).not.toMatch(/ave direct/);
    expect(stdout).not.toMatch(/graphic\.upsert/);
    expect(stdout).not.toMatch(/encode\.preview/);
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

  it("CLI stack layout + captions + still/window at 1080×1920", async () => {
    const root = await tempSessionsRoot("cutstill-cli-stack-");
    const sourcePath = await ensureStandInMp4();
    const env = { CUTSTILL_SESSIONS_ROOT: root };
    const created = await cutstill(["session.create", "--json", JSON.stringify({ sourcePath })], env);
    expect(created.code, `session.create failed: ${created.stdout}\n${created.stderr}`).toBe(0);
    const sessionId = (created.json as { sessionId: string }).sessionId;

    const laid = await cutstill(
      [
        "timeline.layout",
        "--json",
        JSON.stringify({
          sessionId,
          mode: "stack",
          stack: { graphics: 0.5, talent: 0.5 },
          captions: [{ text: "sample line", startSec: 0.3, endSec: 2.0 }],
          palette: { captionBand: "#111111", caption: "#ffffff" },
        }),
      ],
      env,
    );
    expect(laid.code, `timeline.layout failed: ${laid.stdout}\n${laid.stderr}`).toBe(0);
    const layout = (
      laid.json as {
        timeline: { layout: { mode: string; stack?: { graphics: number; talent: number }; captions?: unknown } };
      }
    ).timeline.layout;
    expect(layout.mode).toBe("stack");
    expect(layout.stack).toEqual({ graphics: 0.5, talent: 0.5 });
    expect(layout.captions).toEqual([{ text: "sample line", startSec: 0.3, endSec: 2.0 }]);

    const got = await cutstill(["session.get", "--json", JSON.stringify({ sessionId })], env);
    expect((got.json as { timeline: { layout: { mode: string } } }).timeline.layout.mode).toBe("stack");

    const still = await cutstill(["render.still", "--json", JSON.stringify({ sessionId, tSec: 0.8 })], env);
    expect(still.code, `render.still failed: ${still.stdout}\n${still.stderr}`).toBe(0);
    const stillPayload = still.json as { path: string; width: number; height: number; imageBase64?: string };
    expect(existsSync(stillPayload.path)).toBe(true);
    expect(stillPayload.width).toBe(1080);
    expect(stillPayload.height).toBe(1920);
    expect(stillPayload.imageBase64).toBeUndefined();

    const win = await cutstill(
      ["render.window", "--json", JSON.stringify({ sessionId, startSec: 0.4, endSec: 1.5 })],
      env,
    );
    expect(win.code, `render.window failed: ${win.stdout}\n${win.stderr}`).toBe(0);
    const winPayload = win.json as { path: string; width: number; height: number };
    expect(existsSync(winPayload.path)).toBe(true);
    expect(winPayload.width).toBe(1080);
    expect(winPayload.height).toBe(1920);
  }, 180_000);

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

  it("CLI media.face + cropFromTalent with a box override", async () => {
    const root = await tempSessionsRoot("cutstill-cli-talent-");
    const sourcePath = await ensureFaceFixtureMp4();
    const env = { CUTSTILL_SESSIONS_ROOT: root };
    const created = await cutstill(["session.create", "--json", JSON.stringify({ sourcePath })], env);
    expect(created.code, `session.create failed: ${created.stdout}`).toBe(0);
    const sessionId = (created.json as { sessionId: string }).sessionId;
    const cropped = await cutstill(
      [
        "timeline.cropFromTalent",
        "--json",
        JSON.stringify({ sessionId, target: "center", zoom: 1, box: FACE_FIXTURE.box }),
      ],
      env,
    );
    expect(cropped.code, `cropFromTalent failed: ${cropped.stdout}\n${cropped.stderr}`).toBe(0);
    const crop = (cropped.json as { timeline: { layout: { mode: string; crop?: { width: number } } } }).timeline
      .layout;
    expect(crop.mode).toBe("stack");
    expect(crop.crop?.width).toBeGreaterThan(0);
  });

  it("CLI fal.models lists wired ids without FAL_KEY", async () => {
    const result = await cutstill(["fal.models", "--json", "{}"], { FAL_KEY: "" });
    expect(result.code, `fal.models failed: ${result.stdout}\n${result.stderr}`).toBe(0);
    const ids = ((result.json as { models: Array<{ id: string }> }).models ?? []).map((item) => item.id);
    expect(ids).toContain("bytedance/seedance-2.5/text-to-video");
    expect(ids).toContain("bytedance/seedance-2.5/image-to-video");
    expect(ids).toContain("bytedance/seedance-2.5/reference-to-video");
  });

  it("CLI fal.generate without FAL_KEY exits 1 with FAL_AUTH", async () => {
    const root = await tempSessionsRoot("cutstill-cli-fal-");
    const sourcePath = await ensureStandInMp4();
    const env = { CUTSTILL_SESSIONS_ROOT: root, FAL_KEY: "" };
    const created = await cutstill(["session.create", "--json", JSON.stringify({ sourcePath })], env);
    const sessionId = (created.json as { sessionId: string }).sessionId;
    const result = await cutstill(
      [
        "fal.generate",
        "--json",
        JSON.stringify({
          sessionId,
          modelId: "bytedance/seedance-2.5/text-to-video",
          prompt: "upper-pane lantern, 9:16",
        }),
      ],
      env,
    );
    expect(result.code).toBe(1);
    expect((result.json as { error: { code: string } }).error.code).toBe("FAL_AUTH");
    expect(result.stdout).not.toMatch(/Key\s+\S+/);
  });

  it("unknown tool exits 1 with { error }", async () => {
    const result = await cutstill(["not.a.tool", "--json", "{}"]);
    expect(result.code).toBe(1);
    expect((result.json as { error: { code: string } }).error.code).toBe("UNKNOWN_TOOL");
  });
});

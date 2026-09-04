import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { readRgb24, samplePixel } from "../src/lib/png.js";
import { extractSourceFrame } from "../src/lib/remotion/engine.js";
import { invokeTool } from "../src/lib/tools/index.js";
import { sessionPaths } from "../src/lib/tools/store.js";
import { CLOCK_TSX, clockMarkSampleX, createSession, ctxFor, tempSessionsRoot } from "./helpers.js";

function isMark(pixel: { r: number; g: number; b: number }): boolean {
  return pixel.r > 180 && pixel.g < 80 && pixel.b < 90;
}

async function upsertClock(sessionId: string, root: string, window = { startSec: 0, endSec: 3 }) {
  await invokeTool(
    "comp.upsert",
    { sessionId, id: "clock", engine: "remotion", source: CLOCK_TSX, window },
    ctxFor(root),
  );
}

describe("window/publish remotion motion", () => {
  it("render.window advances a useCurrentFrame comp; frame 0 and a later frame differ", async () => {
    const root = await tempSessionsRoot("cutstill-motion-win-");
    const { sessionId } = await createSession(root);
    await upsertClock(sessionId, root);
    await invokeTool("render.still", { sessionId, tSec: 0.8 }, ctxFor(root));
    const result = (await invokeTool(
      "render.window",
      { sessionId, startSec: 0, endSec: 1.4 },
      ctxFor(root),
    )) as { path: string; width: number; compsActive: string[] };
    expect(result.compsActive).toEqual(["clock"]);
    const first = result.path.replace(/\.mp4$/, "-first.png");
    const later = result.path.replace(/\.mp4$/, "-later.png");
    await extractSourceFrame({ sourcePath: result.path, fileSec: 0.05, dest: first });
    await extractSourceFrame({ sourcePath: result.path, fileSec: 1.05, dest: later });
    const firstRgb = await readRgb24(first);
    const laterRgb = await readRgb24(later);
    expect(isMark(samplePixel(firstRgb, result.width, 20, 16))).toBe(true);
    expect(isMark(samplePixel(laterRgb, result.width, 20, 16))).toBe(false);
    expect(isMark(samplePixel(laterRgb, result.width, 224, 16))).toBe(true);
  });

  it("late source window uses the corresponding composition frames, not a repeated frame-0 poster", async () => {
    const root = await tempSessionsRoot("cutstill-motion-late-");
    const { sessionId } = await createSession(root);
    await upsertClock(sessionId, root);
    await invokeTool("render.still", { sessionId, tSec: 1.9 }, ctxFor(root));
    const result = (await invokeTool(
      "render.window",
      { sessionId, startSec: 1.8, endSec: 2.8 },
      ctxFor(root),
    )) as { path: string; width: number };
    const host = readFileSync(sessionPaths(root, sessionId).remotion + "/VideoHost.tsx", "utf8");
    expect(host).toMatch(/trimBefore=\{5[0-9]\}/);
    expect(host).toContain("<OffthreadVideo");
    expect(host).not.toContain("frame.png");

    const first = result.path.replace(/\.mp4$/, "-late-first.png");
    const later = result.path.replace(/\.mp4$/, "-late-later.png");
    await extractSourceFrame({ sourcePath: result.path, fileSec: 0.05, dest: first });
    await extractSourceFrame({ sourcePath: result.path, fileSec: 0.7, dest: later });
    const firstRgb = await readRgb24(first);
    const laterRgb = await readRgb24(later);
    // source 1.8s → composition frame 54 → x = (54*7)%560 = 378; +0.05s ≈ frame 55.5 → x≈388
    expect(isMark(samplePixel(firstRgb, result.width, 12, 16)), "must not stay on composition frame 0").toBe(false);
    expect(isMark(samplePixel(firstRgb, result.width, 396, 16))).toBe(true);
    expect(isMark(samplePixel(laterRgb, result.width, 396, 16))).toBe(false);
    expect(isMark(samplePixel(laterRgb, result.width, 530, 16))).toBe(true);
  });

  it("render.still uses source-aligned composition frames at a late source second", async () => {
    const root = await tempSessionsRoot("cutstill-motion-still-");
    const { sessionId } = await createSession(root);
    await upsertClock(sessionId, root);
    const still = (await invokeTool("render.still", { sessionId, tSec: 1.9 }, ctxFor(root))) as {
      path: string;
      width: number;
    };
    const rgb = await readRgb24(still.path);
    expect(isMark(samplePixel(rgb, still.width, clockMarkSampleX(1.9), 16))).toBe(true);
    expect(isMark(samplePixel(rgb, still.width, clockMarkSampleX(0), 16))).toBe(false);
  });

  it("render.publish uses the same animated composition path", async () => {
    const root = await tempSessionsRoot("cutstill-motion-pub-");
    const { sessionId } = await createSession(root);
    await upsertClock(sessionId, root);
    const published = (await invokeTool("render.publish", { sessionId }, ctxFor(root))) as {
      path: string;
      width: number;
    };
    expect(existsSync(published.path)).toBe(true);
    const host = readFileSync(sessionPaths(root, sessionId).remotion + "/VideoHost.tsx", "utf8");
    expect(host).toContain("<OffthreadVideo");
    expect(host).toContain("id=\"VideoHost\"");
    expect(host).not.toContain("frame.png");
    const first = published.path.replace(/\.mp4$/, "-pub-first.png");
    const later = published.path.replace(/\.mp4$/, "-pub-later.png");
    await extractSourceFrame({ sourcePath: published.path, fileSec: 0.05, dest: first });
    await extractSourceFrame({ sourcePath: published.path, fileSec: 1.2, dest: later });
    const firstRgb = await readRgb24(first);
    const laterRgb = await readRgb24(later);
    expect(isMark(samplePixel(firstRgb, published.width, 20, 16))).toBe(true);
    expect(isMark(samplePixel(laterRgb, published.width, 20, 16))).toBe(false);
    expect(isMark(samplePixel(laterRgb, published.width, 256, 16))).toBe(true);
  });
});

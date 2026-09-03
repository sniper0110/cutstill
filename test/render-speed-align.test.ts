import { describe, expect, it } from "vitest";
import { generateStandInMp4 } from "../scripts/generate-fixtures.js";
import { readRgb24, samplePixel } from "../src/lib/png.js";
import { extractSourceFrame } from "../src/lib/remotion/engine.js";
import { invokeTool } from "../src/lib/tools/index.js";
import { createSession, ctxFor, LATE_CUE_TSX, tempSessionsRoot } from "./helpers.js";

function isCue(pixel: { r: number; g: number; b: number }): boolean {
  return pixel.r > 180 && pixel.g < 80 && pixel.b < 90;
}

describe("window sequence timing under speed", () => {
  it("shows a last-second source cue in the last output frames at 1.1×", async () => {
    const root = await tempSessionsRoot("cutstill-speed-align-");
    const source = await generateStandInMp4(`${root}/source-12s.mp4`, 12);
    const { sessionId } = await createSession(root, source);
    await invokeTool("timeline.speed", { sessionId, rate: 1.1 }, ctxFor(root));
    await invokeTool(
      "comp.upsert",
      {
        sessionId,
        id: "late-cue",
        engine: "remotion",
        source: LATE_CUE_TSX,
        window: { startSec: 0, endSec: 12 },
      },
      ctxFor(root),
    );
    const result = (await invokeTool(
      "render.window",
      { sessionId, startSec: 0, endSec: 12 },
      ctxFor(root),
    )) as { path: string; width: number; durationSec: number; compsActive: string[] };
    expect(result.compsActive).toEqual(["late-cue"]);
    expect(result.durationSec).toBeGreaterThan(10.5);
    expect(result.durationSec).toBeLessThan(11.3);

    const early = result.path.replace(/\.mp4$/, "-early.png");
    const late = result.path.replace(/\.mp4$/, "-late.png");
    await extractSourceFrame({ sourcePath: result.path, fileSec: 1.0, dest: early });
    await extractSourceFrame({ sourcePath: result.path, fileSec: result.durationSec - 0.35, dest: late });
    const earlyRgb = await readRgb24(early);
    const lateRgb = await readRgb24(late);
    expect(isCue(samplePixel(earlyRgb, result.width, 70, 70))).toBe(false);
    expect(isCue(samplePixel(lateRgb, result.width, 70, 70))).toBe(true);
  });
});

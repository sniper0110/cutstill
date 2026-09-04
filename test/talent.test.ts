import { describe, expect, it } from "vitest";
import { FACE_FIXTURE, ensureFaceFixtureMp4 } from "../scripts/generate-fixtures.js";
import {
  boxFromLandmarks,
  coverWindow,
  cropFromTalentBox,
  normalizeBox,
  parseTalentTarget,
  sampleTimes,
} from "../src/lib/talent/crop.js";
import { poseModelPath } from "../src/lib/talent/pose.js";
import { getToolsCatalog, invokeTool, isV1ToolName } from "../src/lib/tools/index.js";
import { readRgb24 } from "../src/lib/png.js";
import { createSession, ctxFor, ensureStandInMp4, tempSessionsRoot } from "./helpers.js";
import { existsSync } from "node:fs";

const FACE = FACE_FIXTURE.box;

function stubDetect(box = FACE) {
  return async () => ({ ...box, confidence: 0.91, sampleCount: 3 });
}

describe("talent crop math", () => {
  it("cover window matches object-fit cover for a 16:9 source in a 1080×960 pane", () => {
    const win = coverWindow({ width: 1920, height: 1080 }, { width: 1080, height: 960 });
    expect(win.height).toBeCloseTo(1080, 5);
    expect(win.width).toBeCloseTo(1080 * (1080 / 960), 5);
    expect(win.y).toBeCloseTo(0, 5);
  });

  it("cropFromTalentBox slides X so the face center hits the pane center", () => {
    const source = { width: FACE_FIXTURE.width, height: FACE_FIXTURE.height };
    const pane = { width: 1080, height: 960 };
    const framed = cropFromTalentBox({
      box: FACE,
      source,
      pane,
      anchor: { anchorX: 0.5, anchorY: 0.5 },
      zoom: 1,
    });
    const face = { x: FACE.x + FACE.width / 2, y: FACE.y + FACE.height / 2 };
    expect(framed.faceCenter).toEqual(face);
    const nx = (face.x - framed.window.x) / framed.window.width;
    expect(nx).toBeCloseTo(0.5, 2);
    expect(framed.crop.width).toBeGreaterThan(0);
    expect(framed.crop.width).toBeLessThanOrEqual(1);
    expect(framed.crop.x + framed.crop.width).toBeLessThanOrEqual(1.0001);
  });

  it("without prior crop, zoom=1 uses cover window size and cover Y — only X slides", () => {
    const source = { width: 1920, height: 1080 };
    const pane = { width: 1080, height: 960 };
    const cover = coverWindow(source, pane);
    const box = { x: 1100, y: 80, width: 220, height: 320 };
    const framed = cropFromTalentBox({
      box,
      source,
      pane,
      anchor: { anchorX: 0.5, anchorY: 0.5 },
      zoom: 1,
    });
    expect(framed.window.width).toBeCloseTo(cover.width, 5);
    expect(framed.window.height).toBeCloseTo(cover.height, 5);
    expect(framed.window.y).toBeCloseTo(cover.y, 5);
    expect(framed.window.x).not.toBeCloseTo(cover.x, 1);
    const faceX = box.x + box.width / 2;
    const nx = (faceX - framed.window.x) / framed.window.width;
    expect(nx).toBeCloseTo(0.5, 2);
  });

  it("zoom=1 with prior crop keeps w/h/y and only recenters X", () => {
    const source = { width: 1920, height: 1080 };
    const pane = { width: 1080, height: 960 };
    const prior = { x: 0.12, y: 0.05, width: 0.76, height: 0.85 };
    const box = { x: 900, y: 80, width: 220, height: 320 };
    const framed = cropFromTalentBox({
      box,
      source,
      pane,
      anchor: { anchorX: 0.5, anchorY: 0.5 },
      zoom: 1,
      priorCrop: prior,
    });
    expect(framed.crop.width).toBeCloseTo(0.76, 5);
    expect(framed.crop.height).toBeCloseTo(0.85, 5);
    expect(framed.crop.y).toBeCloseTo(0.05, 5);
    expect(framed.crop.x).not.toBeCloseTo(0.12, 2);
    const faceX = (box.x + box.width / 2) / source.width;
    const nx = (faceX - framed.crop.x) / framed.crop.width;
    expect(nx).toBeCloseTo(0.5, 2);
  });

  it("parses target center and custom anchors", () => {
    expect(parseTalentTarget("center")).toEqual({ anchorX: 0.5, anchorY: 0.5 });
    expect(parseTalentTarget({ anchorX: 0.4, anchorY: 0.35 })).toEqual({ anchorX: 0.4, anchorY: 0.35 });
  });

  it("boxFromLandmarks builds a face+chest box from pose points", () => {
    const source = { width: 1000, height: 1000 };
    const landmarks = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, visibility: 0 }));
    landmarks[0] = { x: 0.62, y: 0.22, visibility: 0.95 };
    landmarks[2] = { x: 0.58, y: 0.2, visibility: 0.9 };
    landmarks[5] = { x: 0.66, y: 0.2, visibility: 0.9 };
    landmarks[7] = { x: 0.55, y: 0.22, visibility: 0.8 };
    landmarks[8] = { x: 0.69, y: 0.22, visibility: 0.8 };
    landmarks[11] = { x: 0.5, y: 0.42, visibility: 0.85 };
    landmarks[12] = { x: 0.74, y: 0.42, visibility: 0.85 };
    landmarks[23] = { x: 0.54, y: 0.78, visibility: 0.7 };
    landmarks[24] = { x: 0.7, y: 0.78, visibility: 0.7 };
    const hit = boxFromLandmarks(landmarks, source);
    expect(hit).toBeTruthy();
    expect(hit!.box.x).toBeGreaterThan(400);
    expect(hit!.box.x + hit!.box.width).toBeLessThan(850);
    expect(hit!.box.y).toBeLessThan(250);
    expect(hit!.box.y + hit!.box.height).toBeGreaterThan(450);
    expect(hit!.confidence).toBeGreaterThan(0.7);
  });

  it("sampleTimes honors tSec, startSec/endSec, and maxSamples", () => {
    expect(sampleTimes({ durationSec: 10, tSec: 1.5 })).toEqual([1.5]);
    expect(sampleTimes({ durationSec: 4, sampleEverySec: 1, maxSamples: 3 })).toEqual([0, 1, 2]);
    expect(
      sampleTimes({ durationSec: 200, startSec: 74.6, endSec: 122.58, sampleEverySec: 0.5, maxSamples: 8 }),
    ).toEqual([74.6, 75.1, 75.6, 76.1, 76.6, 77.1, 77.6, 78.1]);
  });
});

describe("media.face + timeline.cropFromTalent", () => {
  it("lists both tools on cutstill.tools.v1", () => {
    const names = getToolsCatalog().tools.map((tool) => tool.name);
    expect(names).toContain("media.face");
    expect(names).toContain("timeline.cropFromTalent");
    expect(isV1ToolName("media.face")).toBe(true);
    const face = getToolsCatalog().tools.find((tool) => tool.name === "media.face");
    expect(face?.errors.some((err) => err.code === "FACE_NOT_FOUND")).toBe(true);
    const blob = JSON.stringify(getToolsCatalog());
    expect(blob.toLowerCase()).not.toContain("pycad");
    expect(blob.toLowerCase()).not.toContain("ave direct");
  });

  it("media.face returns pixel box + normalized fractions from a stubbed detector", async () => {
    const root = await tempSessionsRoot("cutstill-face-");
    const sourcePath = await ensureFaceFixtureMp4();
    const { sessionId } = await createSession(root, sourcePath);
    const result = (await invokeTool(
      "media.face",
      { sessionId, tSec: 0.4 },
      ctxFor(root, { detectTalent: stubDetect() }),
    )) as {
      x: number;
      y: number;
      width: number;
      height: number;
      normalized: { x: number; y: number; width: number; height: number };
      confidence: number;
      sampleCount: number;
      sourceWidth: number;
      sourceHeight: number;
    };
    expect(result.x).toBeCloseTo(FACE.x, 5);
    expect(result.y).toBeCloseTo(FACE.y, 5);
    expect(result.width).toBeCloseTo(FACE.width, 5);
    expect(result.height).toBeCloseTo(FACE.height, 5);
    expect(result.normalized).toEqual(normalizeBox(FACE, { width: result.sourceWidth, height: result.sourceHeight }));
    expect(result.confidence).toBeGreaterThan(0.5);
    expect(result.sampleCount).toBe(3);
    expect(result.sourceWidth).toBe(FACE_FIXTURE.width);
    expect(result.sourceHeight).toBe(FACE_FIXTURE.height);
  });

  it("media.face with startSec/endSec samples that window, not the opener", async () => {
    const root = await tempSessionsRoot("cutstill-face-win-");
    const sourcePath = await ensureFaceFixtureMp4();
    const { sessionId } = await createSession(root, sourcePath);
    const result = (await invokeTool(
      "media.face",
      { sessionId, startSec: 1.2, endSec: 1.9, sampleEverySec: 0.3, maxSamples: 8 },
      ctxFor(root, { detectTalent: stubDetect() }),
    )) as { sampledSec: number[] };
    expect(result.sampledSec.length).toBeGreaterThan(0);
    expect(Math.min(...result.sampledSec)).toBeGreaterThanOrEqual(1.2);
    expect(Math.max(...result.sampledSec)).toBeLessThan(1.9);
    expect(result.sampledSec.some((t) => t < 0.5)).toBe(false);
  });

  it("media.face without a window defaults to keep/cut remaining spans", async () => {
    const root = await tempSessionsRoot("cutstill-face-keep-");
    const sourcePath = await ensureStandInMp4();
    const { sessionId } = await createSession(root, sourcePath);
    await invokeTool("timeline.keep", { sessionId, startSec: 1.4, endSec: 2.6 }, ctxFor(root));
    const result = (await invokeTool(
      "media.face",
      { sessionId, sampleEverySec: 0.5, maxSamples: 8 },
      ctxFor(root, { detectTalent: stubDetect() }),
    )) as { sampledSec: number[] };
    expect(result.sampledSec[0]).toBeGreaterThanOrEqual(1.4);
    expect(result.sampledSec.every((t) => t >= 1.4 && t < 2.6)).toBe(true);
    expect(result.sampledSec.some((t) => t < 1)).toBe(false);
  });

  it("media.face after a cut that removes the opener does not sample from 0", async () => {
    const root = await tempSessionsRoot("cutstill-face-cut-");
    const sourcePath = await ensureStandInMp4();
    const { sessionId } = await createSession(root, sourcePath);
    await invokeTool("timeline.cut", { sessionId, startSec: 0, endSec: 1.1 }, ctxFor(root));
    const result = (await invokeTool(
      "media.face",
      { sessionId, sampleEverySec: 0.5, maxSamples: 8 },
      ctxFor(root, { detectTalent: stubDetect() }),
    )) as { sampledSec: number[] };
    expect(result.sampledSec[0]).toBeGreaterThanOrEqual(1.1);
    expect(result.sampledSec.every((t) => t >= 1.1)).toBe(true);
  });

  it("cropFromTalent zoom:1 preserves an approved crop scale and only moves X", async () => {
    const root = await tempSessionsRoot("cutstill-talent-preserve-");
    const sourcePath = await ensureFaceFixtureMp4();
    const { sessionId } = await createSession(root, sourcePath);
    await invokeTool(
      "timeline.layout",
      {
        sessionId,
        mode: "stack",
        stack: { graphics: 0.5, talent: 0.5 },
        crop: { x: 0.12, y: 0.05, width: 0.76, height: 0.85 },
      },
      ctxFor(root),
    );
    const framed = (await invokeTool(
      "timeline.cropFromTalent",
      { sessionId, target: "center", zoom: 1, box: FACE },
      ctxFor(root),
    )) as {
      timeline: { layout: { crop: { x: number; y: number; width: number; height: number } } };
    };
    const crop = framed.timeline.layout.crop;
    expect(crop.width).toBeCloseTo(0.76, 5);
    expect(crop.height).toBeCloseTo(0.85, 5);
    expect(crop.y).toBeCloseTo(0.05, 5);
    expect(crop.x).not.toBeCloseTo(0.12, 2);
  });

  it("cropFromTalent writes layout.crop and centers the face blob in the lower pane", async () => {
    const root = await tempSessionsRoot("cutstill-talent-crop-");
    const sourcePath = await ensureFaceFixtureMp4();
    const { sessionId } = await createSession(root, sourcePath);
    await invokeTool(
      "timeline.layout",
      { sessionId, mode: "stack", stack: { graphics: 0.5, talent: 0.5 } },
      ctxFor(root),
    );
    const framed = (await invokeTool(
      "timeline.cropFromTalent",
      { sessionId, target: "center", zoom: 1, box: FACE },
      ctxFor(root),
    )) as {
      timeline: { layout: { mode: string; crop?: { x: number; y: number; width: number; height: number } } };
    };
    expect(framed.timeline.layout.mode).toBe("stack");
    expect(framed.timeline.layout.crop).toBeTruthy();
    expect(framed.timeline.layout.crop!.width).toBeGreaterThan(0);

    const still = (await invokeTool("render.still", { sessionId, tSec: 0.4 }, ctxFor(root))) as {
      path: string;
      width: number;
      height: number;
    };
    expect(still.width).toBe(1080);
    expect(still.height).toBe(1920);
    const rgb = await readRgb24(still.path);
    let sx = 0;
    let n = 0;
    const paneTop = 960;
    for (let y = paneTop; y < still.height; y += 2) {
      for (let x = 0; x < still.width; x += 2) {
        const i = (y * still.width + x) * 3;
        const r = rgb[i] ?? 0;
        const g = rgb[i + 1] ?? 0;
        const b = rgb[i + 2] ?? 0;
        if (r > 180 && g < 90 && b > 100) {
          sx += x;
          n += 1;
        }
      }
    }
    expect(n).toBeGreaterThan(40);
    const cx = sx / n;
    expect(cx).toBeGreaterThan(540 - 80);
    expect(cx).toBeLessThan(540 + 80);
  }, 90_000);
});

describe("MediaPipe Pose Landmarker Lite (optional)", () => {
  it("vendors the lite model for offline CI", () => {
    expect(existsSync(poseModelPath())).toBe(true);
  });
});

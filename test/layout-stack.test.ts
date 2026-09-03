import { describe, expect, it } from "vitest";
import { layoutCanvasSize, STACK_CANVAS_HEIGHT, STACK_CANVAS_WIDTH, stackFractions } from "../src/lib/layout.js";
import { analyzeRgb, readRgb24, samplePixel } from "../src/lib/png.js";
import { extractSourceFrame } from "../src/lib/remotion/engine.js";
import { stillHostSource } from "../src/lib/remotion/host.js";
import { getToolsCatalog, invokeTool } from "../src/lib/tools/index.js";
import { createSession, ctxFor, tempSessionsRoot } from "./helpers.js";

describe("layout canvas + stack fractions", () => {
  it("defaults stack to 1080×1920 and uses caller fractions", () => {
    const stack = { mode: "stack" as const, stack: { graphics: 0.4, talent: 0.6 } };
    expect(layoutCanvasSize(stack, { width: 640, height: 360 })).toEqual({
      width: STACK_CANVAS_WIDTH,
      height: STACK_CANVAS_HEIGHT,
    });
    expect(stackFractions(stack)).toEqual({ graphics: 0.4, talent: 0.6 });
    expect(layoutCanvasSize({ mode: "full" }, { width: 640, height: 360 })).toEqual({
      width: 640,
      height: 360,
    });
    expect(
      layoutCanvasSize({ mode: "stack", width: 720, height: 1280 }, { width: 640, height: 360 }),
    ).toEqual({ width: 720, height: 1280 });
  });

  it("stack host is a column with caller percents and no baked 25/75", () => {
    const host = stillHostSource({
      active: [],
      width: 1080,
      height: 1920,
      fps: 30,
      tSec: 0.5,
      layout: { mode: "stack", stack: { graphics: 0.4, talent: 0.6 } },
    });
    expect(host).toMatch(/flexDirection: "column"/);
    expect(host).toMatch(/40%/);
    expect(host).toMatch(/60%/);
    expect(host).toMatch(/objectFit:"cover"/);
    expect(host).not.toMatch(/25%/);
    expect(host).not.toMatch(/75%/);
    expect(host).toContain("width={1080}");
    expect(host).toContain("height={1920}");
  });

  it("stack host applies layout.crop to the talent image, not only mode=crop", () => {
    const crop = { x: 0.2, y: 0.1, width: 0.4, height: 0.5 };
    const stacked = stillHostSource({
      active: [],
      width: 1080,
      height: 1920,
      fps: 30,
      tSec: 0.5,
      layout: { mode: "stack", stack: { graphics: 0.5, talent: 0.5 }, crop },
    });
    expect(stacked).toMatch(/left:"-50%"/);
    expect(stacked).toMatch(/top:"-20%"/);
    expect(stacked).toMatch(/width:"250%"/);
    expect(stacked).toMatch(/height:"200%"/);
    expect(stacked).toMatch(/position:"absolute"/);
    const uncropped = stillHostSource({
      active: [],
      width: 1080,
      height: 1920,
      fps: 30,
      tSec: 0.5,
      layout: { mode: "stack", stack: { graphics: 0.5, talent: 0.5 } },
    });
    expect(uncropped).not.toMatch(/transform:"scale\(/);
  });

  it("stack host draws palette.divider as a horizontal seam line", () => {
    const host = stillHostSource({
      active: [],
      width: 1080,
      height: 1920,
      fps: 30,
      tSec: 0.5,
      layout: {
        mode: "stack",
        stack: { graphics: 0.5, talent: 0.5 },
        palette: { divider: "#00ff66" },
      },
    });
    expect(host).toContain("#00ff66");
    expect(host).toMatch(/height:\s*4/);
    expect(host).toMatch(/top:\s*958/);
  });
});

describe("timeline.layout stack + captions", () => {
  it("accepts stack mode and persists fractions and captions", async () => {
    const root = await tempSessionsRoot("cutstill-stack-api-");
    const { sessionId } = await createSession(root);
    const snap = (await invokeTool(
      "timeline.layout",
      {
        sessionId,
        mode: "stack",
        stack: { graphics: 0.45, talent: 0.55 },
        captions: [{ text: "sample line", startSec: 0.2, endSec: 1.8 }],
        palette: { captionBand: "#00ff66", caption: "#111111" },
      },
      ctxFor(root),
    )) as {
      timeline: {
        layout: {
          mode: string;
          stack?: { graphics: number; talent: number };
          captions?: Array<{ text: string }>;
        };
      };
    };
    expect(snap.timeline.layout.mode).toBe("stack");
    expect(snap.timeline.layout.stack).toEqual({ graphics: 0.45, talent: 0.55 });
    expect(snap.timeline.layout.captions).toEqual([{ text: "sample line", startSec: 0.2, endSec: 1.8 }]);
    const got = (await invokeTool("session.get", { sessionId }, ctxFor(root))) as {
      timeline: { layout: { mode: string; stack?: { graphics: number; talent: number }; captions?: unknown } };
    };
    expect(got.timeline.layout.mode).toBe("stack");
    expect(got.timeline.layout.stack).toEqual({ graphics: 0.45, talent: 0.55 });
    expect(got.timeline.layout.captions).toEqual([{ text: "sample line", startSec: 0.2, endSec: 1.8 }]);
    const catalog = JSON.stringify(getToolsCatalog());
    expect(catalog).toContain('"stack"');
    expect(catalog.toLowerCase()).not.toContain("pycad");
    expect(catalog).not.toMatch(/0\.25|0\.75|25\s*\/\s*75/);
  });

  it("stack still is 1080×1920 and the lower pane shows talent without a full black canvas", async () => {
    const root = await tempSessionsRoot("cutstill-stack-talent-");
    const { sessionId } = await createSession(root);
    await invokeTool(
      "timeline.layout",
      { sessionId, mode: "stack", stack: { graphics: 0.5, talent: 0.5 } },
      ctxFor(root),
    );
    const still = (await invokeTool("render.still", { sessionId, tSec: 0.5 }, ctxFor(root))) as {
      path: string;
      width: number;
      height: number;
      compsActive: string[];
    };
    expect(still.width).toBe(1080);
    expect(still.height).toBe(1920);
    expect(still.compsActive).toEqual([]);
    const rgb = await readRgb24(still.path);
    const lower = samplePixel(rgb, still.width, 540, 1440);
    expect(lower.r + lower.g + lower.b).toBeGreaterThan(30);
    expect(analyzeRgb(rgb).uniqueColors).toBeGreaterThan(16);
    const upper = samplePixel(rgb, still.width, 540, 200);
    expect(Math.abs(upper.r - lower.r) + Math.abs(upper.g - lower.g) + Math.abs(upper.b - lower.b)).toBeGreaterThan(
      20,
    );
  });

  it("draws a timed caption on the stack seam for still and window", async () => {
    const root = await tempSessionsRoot("cutstill-stack-cap-");
    const { sessionId } = await createSession(root);
    await invokeTool(
      "timeline.layout",
      {
        sessionId,
        mode: "stack",
        stack: { graphics: 0.5, talent: 0.5 },
        captions: [{ text: "midline sample", startSec: 0.3, endSec: 2.0 }],
        palette: { captionBand: "#00ff66", caption: "#111111" },
      },
      ctxFor(root),
    );
    const still = (await invokeTool("render.still", { sessionId, tSec: 0.8 }, ctxFor(root))) as {
      path: string;
      width: number;
    };
    const stillRgb = await readRgb24(still.path);
    const seam = samplePixel(stillRgb, still.width, 540, 960);
    expect(seam.g).toBeGreaterThan(180);
    expect(seam.r).toBeLessThan(80);

    const outside = (await invokeTool("render.still", { sessionId, tSec: 2.4 }, ctxFor(root))) as {
      path: string;
      width: number;
    };
    const outsideRgb = await readRgb24(outside.path);
    const laterSeam = samplePixel(outsideRgb, outside.width, 540, 960);
    expect(laterSeam.g).toBeLessThan(160);

    const win = (await invokeTool(
      "render.window",
      { sessionId, startSec: 0.4, endSec: 1.5 },
      ctxFor(root),
    )) as { path: string; width: number; height: number };
    expect(win.width).toBe(1080);
    expect(win.height).toBe(1920);
    const frame = win.path.replace(/\.mp4$/, "-cap.png");
    await extractSourceFrame({ sourcePath: win.path, fileSec: 0.3, dest: frame });
    const winRgb = await readRgb24(frame);
    const winSeam = samplePixel(winRgb, win.width, 540, 960);
    expect(winSeam.g).toBeGreaterThan(160);
  });

  it("stack+crop changes the talent pane versus uncropped cover", async () => {
    const root = await tempSessionsRoot("cutstill-stack-crop-");
    const { sessionId } = await createSession(root);
    await invokeTool(
      "timeline.layout",
      { sessionId, mode: "stack", stack: { graphics: 0.5, talent: 0.5 } },
      ctxFor(root),
    );
    const open = (await invokeTool("render.still", { sessionId, tSec: 0.5 }, ctxFor(root))) as {
      path: string;
      width: number;
    };
    const openRgb = await readRgb24(open.path);
    const openTalent = samplePixel(openRgb, open.width, 540, 1440);

    await invokeTool(
      "timeline.layout",
      {
        sessionId,
        mode: "stack",
        stack: { graphics: 0.5, talent: 0.5 },
        crop: { x: 0, y: 0, width: 0.25, height: 0.35 },
      },
      ctxFor(root),
    );
    const cropped = (await invokeTool("render.still", { sessionId, tSec: 0.5 }, ctxFor(root))) as {
      path: string;
      width: number;
    };
    const cropRgb = await readRgb24(cropped.path);
    const cropTalent = samplePixel(cropRgb, cropped.width, 540, 1440);
    const upper = samplePixel(cropRgb, cropped.width, 540, 200);
    expect(
      Math.abs(cropTalent.r - openTalent.r) +
        Math.abs(cropTalent.g - openTalent.g) +
        Math.abs(cropTalent.b - openTalent.b),
    ).toBeGreaterThan(20);
    expect(upper.r + upper.g + upper.b).toBeLessThan(80);
  });

  it("stack still draws palette.divider on the seam without captions", async () => {
    const root = await tempSessionsRoot("cutstill-stack-div-");
    const { sessionId } = await createSession(root);
    await invokeTool(
      "timeline.layout",
      {
        sessionId,
        mode: "stack",
        stack: { graphics: 0.5, talent: 0.5 },
        palette: { divider: "#00ff66" },
      },
      ctxFor(root),
    );
    const still = (await invokeTool("render.still", { sessionId, tSec: 0.5 }, ctxFor(root))) as {
      path: string;
      width: number;
    };
    const rgb = await readRgb24(still.path);
    const seam = samplePixel(rgb, still.width, 540, 960);
    expect(seam.g).toBeGreaterThan(180);
    expect(seam.r).toBeLessThan(80);
  });

  it("stack host uses caller bandHeight instead of a fixed 64px strip", () => {
    const host = stillHostSource({
      active: [],
      width: 1080,
      height: 1920,
      fps: 30,
      tSec: 0.8,
      layout: { mode: "stack", stack: { graphics: 0.5, talent: 0.5 }, bandHeight: 160 },
      captions: [{ text: "real band" }],
    });
    expect(host).toMatch(/height:\s*160/);
    expect(host).not.toMatch(/height:\s*64/);
    expect(host).toMatch(/top:\s*880/);
  });

  it("bandHeight 160 paints a taller opaque seam than the 64px default", async () => {
    const root = await tempSessionsRoot("cutstill-bandh-");
    const { sessionId } = await createSession(root);
    await invokeTool(
      "timeline.layout",
      {
        sessionId,
        mode: "stack",
        stack: { graphics: 0.5, talent: 0.5 },
        bandHeight: 160,
        captions: [{ text: "real band", startSec: 0, endSec: 3 }],
        palette: { captionBand: "#00ff66", caption: "#111111" },
      },
      ctxFor(root),
    );
    const still = (await invokeTool("render.still", { sessionId, tSec: 0.8 }, ctxFor(root))) as {
      path: string;
      width: number;
    };
    const rgb = await readRgb24(still.path);
    const inner = samplePixel(rgb, still.width, 40, 960);
    const outer = samplePixel(rgb, still.width, 40, 890);
    expect(inner.g).toBeGreaterThan(180);
    expect(outer.g).toBeGreaterThan(180);
    expect(inner.r).toBeLessThan(80);
    expect(outer.r).toBeLessThan(80);
  });

  it("at tSec inside word2 the host paints that word with palette.captionActive", () => {
    const host = stillHostSource({
      active: [],
      width: 1080,
      height: 1920,
      fps: 30,
      tSec: 1.1,
      layout: {
        mode: "stack",
        stack: { graphics: 0.5, talent: 0.5 },
        palette: { caption: "#ffffff", captionActive: "#00ff66", captionBand: "#111111" },
      },
      captions: [
        {
          text: "one two",
          words: [
            { text: "one", startSec: 0.2, endSec: 0.9 },
            { text: "two", startSec: 0.9, endSec: 1.8 },
          ],
        },
      ],
    });
    expect(host).toMatch(/color:\s*"#ffffff"[\s\S]{0,80}"one"/);
    expect(host).toMatch(/color:\s*"#00ff66"[\s\S]{0,80}"two"/);
    expect(host).not.toMatch(/color:\s*"#00ff66"[\s\S]{0,80}"one"/);
  });

  it("persists bandHeight + caption words and still highlights word2 at tSec", async () => {
    const root = await tempSessionsRoot("cutstill-karaoke-");
    const { sessionId } = await createSession(root);
    const snap = (await invokeTool(
      "timeline.layout",
      {
        sessionId,
        mode: "stack",
        stack: { graphics: 0.5, talent: 0.5 },
        bandHeight: 120,
        captionFontSize: 48,
        captions: [
          {
            text: "one two",
            startSec: 0.2,
            endSec: 2.0,
            words: [
              { text: "one", startSec: 0.2, endSec: 0.9 },
              { text: "two", startSec: 0.9, endSec: 1.8 },
            ],
          },
        ],
        palette: { captionBand: "#111111", caption: "#ffffff", captionActive: "#00ff66" },
      },
      ctxFor(root),
    )) as {
      timeline: {
        layout: {
          bandHeight?: number;
          captionFontSize?: number;
          captions?: Array<{ words?: Array<{ text: string }> }>;
        };
      };
    };
    expect(snap.timeline.layout.bandHeight).toBe(120);
    expect(snap.timeline.layout.captionFontSize).toBe(48);
    expect(snap.timeline.layout.captions?.[0]?.words).toEqual([
      { text: "one", startSec: 0.2, endSec: 0.9 },
      { text: "two", startSec: 0.9, endSec: 1.8 },
    ]);
    const still = (await invokeTool("render.still", { sessionId, tSec: 1.1 }, ctxFor(root))) as {
      path: string;
    };
    const { readFile } = await import("node:fs/promises");
    const { sessionPaths } = await import("../src/lib/tools/store.js");
    const host = await readFile(sessionPaths(root, sessionId).remotion + "/StillHost.tsx", "utf8");
    expect(host).toMatch(/height:\s*120/);
    expect(host).toMatch(/fontSize:\s*48/);
    expect(host).toMatch(/#00ff66/);
    expect(host).toMatch(/"two"/);
    expect(still.path).toBeTruthy();
    const catalog = JSON.stringify(getToolsCatalog());
    expect(catalog).toContain("bandHeight");
    expect(catalog).toContain("captionActive");
    expect(catalog).toContain("words");
  });
});

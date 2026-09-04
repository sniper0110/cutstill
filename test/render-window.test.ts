import { existsSync, readFileSync, statSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { probeMediaMetadata } from "../src/lib/probe.js";
import { isPngMagic, readRgb24, samplePixel } from "../src/lib/png.js";
import { clampWindow, extractSourceFrame, WINDOW_MAX_SEC } from "../src/lib/remotion/engine.js";
import { handleMcpRequest, invokeTool } from "../src/lib/tools/index.js";
import { createSession, ctxFor, MARKER_TSX, MOVING_TSX, tempSessionsRoot } from "./helpers.js";

describe("render.window", () => {
  it("caps duration at 12s", () => {
    const range = clampWindow(0, 40, 60);
    expect(range.endSec - range.startSec).toBe(WINDOW_MAX_SEC);
  });

  it("writes a real short mp4 with video and duration in range", async () => {
    const root = await tempSessionsRoot();
    const { sessionId } = await createSession(root);
    const result = (await invokeTool(
      "render.window",
      { sessionId, startSec: 0.4, endSec: 2.0 },
      ctxFor(root),
    )) as {
      path: string;
      posterPath: string;
      startSec: number;
      endSec: number;
      durationSec: number;
      width: number;
      height: number;
    };
    expect(result.path).toMatch(/windows\/window-.*\.mp4$/);
    expect(existsSync(result.path)).toBe(true);
    expect(statSync(result.path).size).toBeGreaterThan(8_000);
    expect(result.durationSec).toBeGreaterThanOrEqual(1.4);
    expect(result.durationSec).toBeLessThanOrEqual(1.8);
    const probed = await probeMediaMetadata(result.path);
    expect(probed.streams.some((stream) => stream.codecType === "video")).toBe(true);
    expect(probed.durationSeconds).toBeGreaterThanOrEqual(1.4);
    expect(probed.durationSeconds).toBeLessThanOrEqual(1.8);
    expect(existsSync(result.posterPath)).toBe(true);
    expect(isPngMagic(readFileSync(result.posterPath))).toBe(true);
    expect(result.width).toBe(640);
    expect(result.height).toBe(360);
  });

  it("keeps a remotion overlay in the encoded frames (not still-only)", async () => {
    const root = await tempSessionsRoot();
    const { sessionId } = await createSession(root);
    await invokeTool(
      "comp.upsert",
      {
        sessionId,
        id: "marker",
        engine: "remotion",
        source: MARKER_TSX,
        window: { startSec: 0.2, endSec: 2.6 },
        props: { color: "#ff0033" },
      },
      ctxFor(root),
    );
    const result = (await invokeTool(
      "render.window",
      { sessionId, startSec: 0.5, endSec: 2.0 },
      ctxFor(root),
    )) as { path: string; compsActive: string[]; width: number };
    expect(result.compsActive).toEqual(["marker"]);
    const frame = result.path.replace(/\.mp4$/, "-inspect.png");
    await extractSourceFrame({ sourcePath: result.path, fileSec: 0.4, dest: frame });
    const rgb = await readRgb24(frame);
    const pixel = samplePixel(rgb, result.width, 70, 70);
    expect(pixel.r).toBeGreaterThan(180);
    expect(pixel.g).toBeLessThan(60);
  });

  it("encodes a moving remotion overlay across frames", async () => {
    const root = await tempSessionsRoot();
    const { sessionId } = await createSession(root);
    await invokeTool(
      "comp.upsert",
      {
        sessionId,
        id: "slide",
        engine: "remotion",
        source: MOVING_TSX,
        window: { startSec: 0, endSec: 3 },
      },
      ctxFor(root),
    );
    const result = (await invokeTool(
      "render.window",
      { sessionId, startSec: 0.2, endSec: 1.6 },
      ctxFor(root),
    )) as { path: string; width: number };
    const first = result.path.replace(/\.mp4$/, "-first.png");
    const later = result.path.replace(/\.mp4$/, "-later.png");
    await extractSourceFrame({ sourcePath: result.path, fileSec: 0.05, dest: first });
    await extractSourceFrame({ sourcePath: result.path, fileSec: 1.05, dest: later });
    const firstRgb = await readRgb24(first);
    const laterRgb = await readRgb24(later);
    const early = samplePixel(firstRgb, result.width, 70, 70);
    const vacated = samplePixel(laterRgb, result.width, 70, 70);
    const arrived = samplePixel(laterRgb, result.width, 230, 70);
    expect(early.g).toBeGreaterThan(180);
    expect(arrived.g).toBeGreaterThan(180);
    expect(vacated.g).toBeLessThan(160);
  });

  it("MCP window result includes an in-band PNG, not path-only", async () => {
    const root = await tempSessionsRoot();
    const { sessionId } = await createSession(root);
    const response = await handleMcpRequest(
      {
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: { name: "render.window", arguments: { sessionId, startSec: 0.3, endSec: 1.5 } },
      },
      ctxFor(root),
    );
    expect(response?.error).toBeUndefined();
    const result = response?.result as {
      content: Array<{ type: string; data?: string; mimeType?: string; text?: string }>;
      structuredContent: { path: string; posterPath: string; imageBase64?: string; mimeType?: string };
    };
    const image = result.content.find((item) => item.type === "image");
    expect(image, "MCP window must return an image content part").toBeTruthy();
    expect(image?.mimeType).toBe("image/png");
    expect(image?.data?.length).toBeGreaterThan(100);
    expect(result.structuredContent.imageBase64).toBe(image?.data);
    expect(result.content.every((item) => item.type === "text")).toBe(false);
    expect(Buffer.from(image!.data!, "base64").subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
    expect(existsSync(result.structuredContent.path)).toBe(true);
    expect(existsSync(result.structuredContent.posterPath)).toBe(true);
  });
});

import { existsSync, readFileSync, statSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { analyzeRgb, isNearSolidPlate, isPngMagic, readRgb24, samplePixel } from "../src/lib/png.js";
import { handleMcpRequest, invokeTool } from "../src/lib/tools/index.js";
import { createSession, ctxFor, CLOCK_TSX, clockMarkSampleX, MARKER_TSX, tempSessionsRoot } from "./helpers.js";

function isMark(pixel: { r: number; g: number; b: number }): boolean {
  return pixel.r > 180 && pixel.g < 80 && pixel.b < 90;
}

describe("render.still", () => {
  it("writes a real PNG that is not a near-solid plate", async () => {
    const root = await tempSessionsRoot();
    const { sessionId } = await createSession(root);
    const still = (await invokeTool("render.still", { sessionId, tSec: 0.4 }, ctxFor(root))) as {
      path: string;
      tSec: number;
      fileSec: number;
      compsActive: string[];
      width: number;
      height: number;
    };
    expect(still.tSec).toBe(0.4);
    expect(still.fileSec).toBe(0.4);
    expect(still.width).toBe(640);
    expect(still.height).toBe(360);
    expect(still.compsActive).toEqual([]);
    expect(existsSync(still.path)).toBe(true);
    const bytes = readFileSync(still.path);
    expect(isPngMagic(bytes)).toBe(true);
    expect(statSync(still.path).size).toBeGreaterThan(2_000);
    const rgb = await readRgb24(still.path);
    expect(isNearSolidPlate(rgb)).toBe(false);
    expect(analyzeRgb(rgb).uniqueColors).toBeGreaterThan(16);
  });

  it("draws caller TSX at a time inside the window (not a built-in kit plate)", async () => {
    const root = await tempSessionsRoot();
    const { sessionId } = await createSession(root);
    await invokeTool(
      "comp.upsert",
      {
        sessionId,
        id: "marker",
        engine: "remotion",
        source: MARKER_TSX,
        window: { startSec: 0.2, endSec: 2.5 },
        props: { color: "#ff0033" },
      },
      ctxFor(root),
    );
    const still = (await invokeTool("render.still", { sessionId, tSec: 0.8 }, ctxFor(root))) as {
      path: string;
      compsActive: string[];
      width: number;
    };
    expect(still.compsActive).toEqual(["marker"]);
    const rgb = await readRgb24(still.path);
    const pixel = samplePixel(rgb, still.width, 70, 70);
    expect(pixel.r).toBeGreaterThan(180);
    expect(pixel.g).toBeLessThan(60);
    expect(pixel.b).toBeLessThan(80);
    const outside = samplePixel(rgb, still.width, 400, 200);
    expect(outside.r).toBeLessThan(180);
  });

  it("renders useCurrentFrame comps at source-aligned frames for each tSec", async () => {
    const root = await tempSessionsRoot("cutstill-still-motion-");
    const { sessionId } = await createSession(root);
    await invokeTool(
      "comp.upsert",
      {
        sessionId,
        id: "clock",
        engine: "remotion",
        source: CLOCK_TSX,
        window: { startSec: 0, endSec: 3 },
      },
      ctxFor(root),
    );
    const early = (await invokeTool("render.still", { sessionId, tSec: 0.2 }, ctxFor(root))) as {
      path: string;
      width: number;
    };
    const late = (await invokeTool("render.still", { sessionId, tSec: 1.5 }, ctxFor(root))) as {
      path: string;
      width: number;
    };
    const earlyRgb = await readRgb24(early.path);
    const lateRgb = await readRgb24(late.path);
    expect(isMark(samplePixel(earlyRgb, early.width, clockMarkSampleX(0.2), 16))).toBe(true);
    expect(isMark(samplePixel(earlyRgb, early.width, clockMarkSampleX(1.5), 16))).toBe(false);
    expect(isMark(samplePixel(lateRgb, late.width, clockMarkSampleX(1.5), 16))).toBe(true);
    expect(isMark(samplePixel(lateRgb, late.width, clockMarkSampleX(0.2), 16))).toBe(false);
    expect(samplePixel(earlyRgb, early.width, clockMarkSampleX(0.2), 16)).not.toEqual(
      samplePixel(lateRgb, late.width, clockMarkSampleX(0.2), 16),
    );
  });

  it("MCP result includes image content, not path-only (AVE path-only still regression)", async () => {
    const root = await tempSessionsRoot();
    const { sessionId } = await createSession(root);
    const response = await handleMcpRequest(
      {
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "render.still", arguments: { sessionId, tSec: 0.5 } },
      },
      ctxFor(root),
    );
    expect(response?.error).toBeUndefined();
    const result = response?.result as {
      content: Array<{ type: string; data?: string; mimeType?: string; text?: string }>;
      structuredContent: { path: string; imageBase64?: string; mimeType?: string };
    };
    const image = result.content.find((item) => item.type === "image");
    expect(image, "MCP must return an image content part so the model sees pixels").toBeTruthy();
    expect(image?.mimeType).toBe("image/png");
    expect(image?.data?.length).toBeGreaterThan(100);
    expect(result.structuredContent.imageBase64).toBe(image?.data);
    expect(result.structuredContent.mimeType).toBe("image/png");
    const textOnly = result.content.every((item) => item.type === "text");
    expect(textOnly).toBe(false);
    const parsed = JSON.parse(result.content.find((item) => item.type === "text")!.text!);
    expect(parsed.path).toBeTruthy();
    expect(Buffer.from(image!.data!, "base64").subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
  });
});

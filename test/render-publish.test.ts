import { existsSync, statSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { probeMediaMetadata } from "../src/lib/probe.js";
import { publishSize } from "../src/lib/remotion/engine.js";
import { invokeTool } from "../src/lib/tools/index.js";
import { createSession, ctxFor, tempSessionsRoot } from "./helpers.js";

describe("render.publish", () => {
  it("keeps fixture size when smaller than 1080p", () => {
    expect(publishSize(640, 360)).toEqual({ width: 640, height: 360 });
    expect(publishSize(3840, 2160)).toEqual({ width: 1920, height: 1080 });
  });

  it("publishes the 3s stand-in with audio and duration near the source", async () => {
    const root = await tempSessionsRoot();
    const { sessionId } = await createSession(root);
    const result = (await invokeTool("render.publish", { sessionId }, ctxFor(root))) as {
      path: string;
      posterPath: string;
      durationSec: number;
      width: number;
      height: number;
      hasAudio: boolean;
      imageBase64?: string;
    };
    expect(result.path).toMatch(/publish\.mp4$/);
    expect(existsSync(result.path)).toBe(true);
    expect(statSync(result.path).size).toBeGreaterThan(20_000);
    expect(result.width).toBe(640);
    expect(result.height).toBe(360);
    expect(result.durationSec).toBeGreaterThan(2.7);
    expect(result.durationSec).toBeLessThan(3.3);
    expect(result.hasAudio).toBe(true);
    expect(result.imageBase64).toBeUndefined();
    const probed = await probeMediaMetadata(result.path);
    expect(probed.hasAudio).toBe(true);
    expect(probed.streams.some((stream) => stream.codecType === "audio")).toBe(true);
    expect(probed.durationSeconds).toBeGreaterThan(2.7);
    expect(probed.durationSeconds).toBeLessThan(3.3);
    expect(existsSync(result.posterPath)).toBe(true);
  });
});

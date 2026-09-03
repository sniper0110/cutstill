import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { readRgb24, samplePixel } from "../src/lib/png.js";
import { invokeTool } from "../src/lib/tools/index.js";
import { createSession, ctxFor, MARKER_TSX, tempSessionsRoot } from "./helpers.js";

describe("comp.upsert", () => {
  it("writes caller TSX into sessions/<id>/comps and patches on the same id", async () => {
    const root = await tempSessionsRoot();
    const { sessionId } = await createSession(root);
    const first = (await invokeTool(
      "comp.upsert",
      {
        sessionId,
        id: "marker",
        engine: "remotion",
        source: MARKER_TSX,
        window: { startSec: 0.2, endSec: 2.4 },
        props: { color: "#ff0033" },
      },
      ctxFor(root),
    )) as { comp: { id: string; sourcePath: string }; comps: unknown[] };

    expect(first.comp.id).toBe("marker");
    expect(first.comps).toHaveLength(1);
    const written = await readFile(first.comp.sourcePath, "utf8");
    expect(written).toContain("export default function Marker");
    expect(written).not.toMatch(/ChipGrid|title_card|classifyPrimitive/);

    const patched = (await invokeTool(
      "comp.upsert",
      {
        sessionId,
        id: "marker",
        engine: "remotion",
        source: MARKER_TSX.replace("#ff0033", "#00ff99"),
        window: { startSec: 0.1, endSec: 2.8 },
      },
      ctxFor(root),
    )) as { comps: Array<{ window: { startSec: number } }> };
    expect(patched.comps).toHaveLength(1);
    expect(patched.comps[0]!.window.startSec).toBe(0.1);
  });

  it("rejects a non-remotion engine", async () => {
    const root = await tempSessionsRoot();
    const { sessionId } = await createSession(root);
    await expect(
      invokeTool(
        "comp.upsert",
        {
          sessionId,
          id: "plate",
          engine: "ffmpeg",
          source: MARKER_TSX,
          window: { startSec: 0, endSec: 1 },
        },
        ctxFor(root),
      ),
    ).rejects.toMatchObject({ code: "UNSUPPORTED_ENGINE" });
  });
});

describe("comp.remove", () => {
  it("deletes a persisted comp so later stills no longer include it", async () => {
    const root = await tempSessionsRoot("cutstill-comp-remove-");
    const { sessionId } = await createSession(root);
    const upserted = (await invokeTool(
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
    )) as { comp: { sourcePath: string } };
    const before = (await invokeTool("render.still", { sessionId, tSec: 0.8 }, ctxFor(root))) as {
      compsActive: string[];
      path: string;
      width: number;
    };
    expect(before.compsActive).toEqual(["marker"]);
    const marked = samplePixel(await readRgb24(before.path), before.width, 70, 70);
    expect(marked.r).toBeGreaterThan(180);

    const removed = (await invokeTool("comp.remove", { sessionId, id: "marker" }, ctxFor(root))) as {
      removed: string;
      comps: Array<{ id: string }>;
    };
    expect(removed.removed).toBe("marker");
    expect(removed.comps).toEqual([]);
    expect(existsSync(upserted.comp.sourcePath)).toBe(false);

    const snap = (await invokeTool("session.get", { sessionId }, ctxFor(root))) as {
      comps: Array<{ id: string }>;
    };
    expect(snap.comps.map((comp) => comp.id)).not.toContain("marker");

    const after = (await invokeTool("render.still", { sessionId, tSec: 0.8 }, ctxFor(root))) as {
      compsActive: string[];
      path: string;
      width: number;
    };
    expect(after.compsActive).toEqual([]);
    const afterRgb = await readRgb24(after.path);
    const box = [
      [50, 50],
      [70, 70],
      [90, 70],
      [100, 80],
    ].map(([x, y]) => samplePixel(afterRgb, after.width, x, y));
    expect(box.every((pixel) => pixel.r > 180 && pixel.g < 80 && pixel.b < 80)).toBe(false);
  });

  it("rejects an unknown id with a clear ToolError", async () => {
    const root = await tempSessionsRoot("cutstill-comp-missing-");
    const { sessionId } = await createSession(root);
    await expect(invokeTool("comp.remove", { sessionId, id: "ghost" }, ctxFor(root))).rejects.toMatchObject({
      code: "COMP_NOT_FOUND",
      message: expect.stringMatching(/ghost|not found/i),
    });
  });
});

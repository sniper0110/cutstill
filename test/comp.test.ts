import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
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

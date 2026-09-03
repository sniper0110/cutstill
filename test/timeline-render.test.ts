import { describe, expect, it } from "vitest";
import { probeMediaMetadata } from "../src/lib/probe.js";
import { stillHostSource } from "../src/lib/remotion/host.js";
import { getToolsCatalog, invokeTool } from "../src/lib/tools/index.js";
import { createSession, ctxFor, MARKER_TSX, tempSessionsRoot } from "./helpers.js";

describe("timeline tools + mapped render", () => {
  it("cut a middle range drops publish duration and maps still fileSec < tSec", async () => {
    const root = await tempSessionsRoot("cutstill-cut-");
    const { sessionId } = await createSession(root);
    const cut = (await invokeTool(
      "timeline.cut",
      { sessionId, startSec: 1, endSec: 2 },
      ctxFor(root),
    )) as { timeline: { removes: Array<{ startSec: number; endSec: number }> } };
    expect(cut.timeline.removes).toEqual([{ startSec: 1, endSec: 2 }]);

    const still = (await invokeTool("render.still", { sessionId, tSec: 2.5 }, ctxFor(root))) as {
      tSec: number;
      fileSec: number;
      path: string;
    };
    expect(still.tSec).toBe(2.5);
    expect(still.fileSec).toBeLessThan(still.tSec);
    expect(still.fileSec).toBeCloseTo(1.5, 1);

    const published = (await invokeTool("render.publish", { sessionId }, ctxFor(root))) as {
      path: string;
      durationSec: number;
    };
    expect(published.durationSec).toBeGreaterThan(1.6);
    expect(published.durationSec).toBeLessThan(2.4);
    const probed = await probeMediaMetadata(published.path);
    expect(probed.durationSeconds).toBeGreaterThan(1.6);
    expect(probed.durationSeconds).toBeLessThan(2.4);
  });

  it("keep protects an overlapping cut and forces 1.0× there while the rest is 1.1×", async () => {
    const root = await tempSessionsRoot("cutstill-keep-");
    const { sessionId } = await createSession(root);
    await invokeTool("timeline.keep", { sessionId, startSec: 1, endSec: 2 }, ctxFor(root));
    await invokeTool("timeline.cut", { sessionId, startSec: 0.5, endSec: 1.5 }, ctxFor(root));
    await invokeTool("timeline.speed", { sessionId, rate: 1.1 }, ctxFor(root));

    const snap = (await invokeTool("session.get", { sessionId }, ctxFor(root))) as {
      timeline: {
        keeps: Array<{ startSec: number; endSec: number }>;
        removes: Array<{ startSec: number; endSec: number }>;
        speed: number;
      };
    };
    expect(snap.timeline.keeps).toEqual([{ startSec: 1, endSec: 2 }]);
    expect(snap.timeline.speed).toBe(1.1);

    const inKeep = (await invokeTool("render.still", { sessionId, tSec: 1.2 }, ctxFor(root))) as {
      tSec: number;
      fileSec: number;
    };
    expect(inKeep.tSec).toBe(1.2);
    expect(inKeep.fileSec).toBeCloseTo(0.5 / 1.1 + 0.2, 1);

    const after = (await invokeTool("render.still", { sessionId, tSec: 2.5 }, ctxFor(root))) as {
      fileSec: number;
      tSec: number;
    };
    expect(after.fileSec).toBeLessThan(after.tSec);
    expect(after.fileSec).toBeCloseTo(0.5 / 1.1 + 1 + 0.5 / 1.1, 1);

    const published = (await invokeTool("render.publish", { sessionId }, ctxFor(root))) as {
      durationSec: number;
    };
    const expected = 0.5 / 1.1 + 1 + 1 / 1.1;
    expect(published.durationSec).toBeGreaterThan(expected - 0.25);
    expect(published.durationSec).toBeLessThan(expected + 0.25);
  });

  it("speed 2× roughly halves publish duration", async () => {
    const root = await tempSessionsRoot("cutstill-speed-");
    const { sessionId } = await createSession(root);
    await invokeTool("timeline.speed", { sessionId, rate: 2 }, ctxFor(root));
    const published = (await invokeTool("render.publish", { sessionId }, ctxFor(root))) as {
      durationSec: number;
    };
    expect(published.durationSec).toBeGreaterThan(1.2);
    expect(published.durationSec).toBeLessThan(1.8);
  });

  it("layout split uses caller fractions, not hardcoded 25/75", async () => {
    const root = await tempSessionsRoot("cutstill-layout-");
    const { sessionId } = await createSession(root);
    const snap = (await invokeTool(
      "timeline.layout",
      {
        sessionId,
        mode: "split",
        split: { talent: 0.4, graphics: 0.6, dividerPx: 8 },
        palette: { divider: "#222222" },
      },
      ctxFor(root),
    )) as {
      timeline: {
        layout: {
          mode: string;
          split?: { talent: number; graphics: number; dividerPx?: number };
          palette?: Record<string, string>;
        };
      };
    };
    expect(snap.timeline.layout.mode).toBe("split");
    expect(snap.timeline.layout.split).toEqual({ talent: 0.4, graphics: 0.6, dividerPx: 8 });
    expect(snap.timeline.layout.palette?.divider).toBe("#222222");

    const catalog = JSON.stringify(getToolsCatalog());
    expect(catalog).not.toMatch(/0\.25|0\.75|25\s*\/\s*75/);
    expect(catalog.toLowerCase()).not.toContain("pycad");
    expect(catalog).not.toContain("encode.preview");

    const host = stillHostSource({
      active: [],
      width: 640,
      height: 360,
      fps: 30,
      tSec: 0,
      layout: snap.timeline.layout,
    });
    expect(host).toMatch(/40%/);
    expect(host).toMatch(/60%/);
    expect(host).not.toMatch(/25%/);
    expect(host).not.toMatch(/75%/);
  });

  it("comp windows stay source seconds after a cut", async () => {
    const root = await tempSessionsRoot("cutstill-comp-map-");
    const { sessionId } = await createSession(root);
    await invokeTool(
      "comp.upsert",
      {
        sessionId,
        id: "marker",
        engine: "remotion",
        source: MARKER_TSX,
        window: { startSec: 1, endSec: 2 },
        props: { color: "#ff0033" },
      },
      ctxFor(root),
    );
    await invokeTool("timeline.cut", { sessionId, startSec: 0.2, endSec: 0.6 }, ctxFor(root));
    const still = (await invokeTool("render.still", { sessionId, tSec: 1.2 }, ctxFor(root))) as {
      compsActive: string[];
      fileSec: number;
      tSec: number;
    };
    expect(still.compsActive).toEqual(["marker"]);
    expect(still.fileSec).toBeCloseTo(0.8, 1);
    expect(still.fileSec).toBeLessThan(still.tSec);
  });
});

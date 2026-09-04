import { describe, expect, it } from "vitest";
import { videoHostSource, stillHostSource } from "../src/lib/remotion/host.js";
import { compositionDurationFrames, planCompSequences, planStillCompSequences } from "../src/lib/remotion/sequences.js";
import type { SessionComp } from "../src/lib/tools/types.js";

const flow: SessionComp = {
  id: "flow",
  engine: "remotion",
  sourcePath: "comps/flow.tsx",
  window: { startSec: 0, endSec: 200 },
};

describe("planCompSequences", () => {
  it("maps a late source window onto the matching composition frames, not frame 0", () => {
    const planned = planCompSequences({
      comps: [flow],
      startSec: 86,
      endSec: 96,
      fps: 30,
      ranges: [{ startSec: 0, endSec: 200, rate: 1.1 }],
    });
    expect(planned).toHaveLength(1);
    expect(planned[0]).toMatchObject({
      id: "flow",
      from: 0,
      trimBefore: 86 * 30,
      playbackRate: 1.1,
    });
    expect(planned[0]!.duration).toBe(Math.round((10 / 1.1) * 30));
    expect(planned[0]!.duration * planned[0]!.playbackRate).toBeCloseTo(10 * 30, 0);
    const lastFrame = planned[0]!.trimBefore + (planned[0]!.duration - 1) * planned[0]!.playbackRate;
    expect(lastFrame / 30).toBeCloseTo(96, 0);
  });

  it("does not compress authored composition time when a 12s source window is 1.1×", () => {
    const planned = planCompSequences({
      comps: [flow],
      startSec: 0,
      endSec: 12,
      fps: 30,
      ranges: [{ startSec: 0, endSec: 200, rate: 1.1 }],
    });
    expect(planned).toHaveLength(1);
    const seq = planned[0]!;
    expect(seq.playbackRate).toBe(1.1);
    expect(seq.trimBefore).toBe(0);
    expect(seq.duration).toBe(Math.round((12 / 1.1) * 30));
    expect(seq.duration * seq.playbackRate).toBeCloseTo(12 * 30, 0);
    const lastFrame = seq.trimBefore + (seq.duration - 1) * seq.playbackRate;
    expect(lastFrame / 30).toBeGreaterThan(11);
    expect(lastFrame / 30).toBeCloseTo(12, 0);
    expect(compositionDurationFrames(seq.duration, [seq])).toBeGreaterThanOrEqual(12 * 30);
  });

  it("keeps a late source cue inside the last output frames after 1.1×", () => {
    const planned = planCompSequences({
      comps: [{ ...flow, window: { startSec: 208.46, endSec: 240 } }],
      startSec: 226,
      endSec: 238,
      fps: 30,
      ranges: [{ startSec: 0, endSec: 400, rate: 1.1 }],
    });
    const seq = planned[0]!;
    expect(seq.trimBefore).toBe(Math.round((226 - 208.46) * 30));
    expect(seq.playbackRate).toBe(1.1);
    const lastFrame = seq.trimBefore + (seq.duration - 1) * seq.playbackRate;
    const lastSourceSec = 208.46 + lastFrame / 30;
    expect(lastSourceSec).toBeGreaterThan(237);
    expect(lastSourceSec).toBeCloseTo(238, 0);
  });

  it("keeps output from>0 when the comp starts after the render window", () => {
    const planned = planCompSequences({
      comps: [{ ...flow, id: "late", window: { startSec: 1.2, endSec: 2.4 } }],
      startSec: 0.4,
      endSec: 2.0,
      fps: 30,
      ranges: [{ startSec: 0, endSec: 3, rate: 1 }],
    });
    expect(planned).toEqual([
      {
        id: "late",
        from: Math.round((1.2 - 0.4) * 30),
        duration: Math.round((2.0 - 1.2) * 30),
        trimBefore: 0,
        playbackRate: 1,
      },
    ]);
  });

  it("emits one sequence per kept slice so a cut does not reset the comp to frame 0", () => {
    const planned = planCompSequences({
      comps: [flow],
      startSec: 0,
      endSec: 3,
      fps: 30,
      ranges: [
        { startSec: 0, endSec: 1, rate: 1 },
        { startSec: 2, endSec: 3, rate: 1 },
      ],
    });
    expect(planned).toEqual([
      { id: "flow", from: 0, duration: 30, trimBefore: 0, playbackRate: 1 },
      { id: "flow", from: 30, duration: 30, trimBefore: 60, playbackRate: 1 },
    ]);
  });
});

describe("planStillCompSequences", () => {
  it("maps a late source still onto the matching composition frame", () => {
    const planned = planStillCompSequences({
      comps: [
        {
          ...flow,
          window: { startSec: 74.55, endSec: 121.18 },
        },
      ],
      tSec: 90,
      fps: 30,
      ranges: [{ startSec: 0, endSec: 200, rate: 1 }],
    });
    expect(planned).toEqual([
      {
        id: "flow",
        from: 0,
        duration: 1,
        trimBefore: Math.round((90 - 74.55) * 30),
        playbackRate: 1,
      },
    ]);
  });

  it("keeps trimBefore aligned to source seconds after a cut", () => {
    const planned = planStillCompSequences({
      comps: [flow],
      tSec: 2.5,
      fps: 30,
      ranges: [
        { startSec: 0, endSec: 1, rate: 1 },
        { startSec: 2, endSec: 3, rate: 1 },
      ],
    });
    expect(planned).toEqual([{ id: "flow", from: 0, duration: 1, trimBefore: 75, playbackRate: 1 }]);
  });
});

describe("videoHostSource", () => {
  it("passes trimBefore through so useCurrentFrame is not reset to 0", () => {
    const host = videoHostSource({
      active: [flow],
      width: 640,
      height: 360,
      fps: 30,
      durationInFrames: 273,
      sourceStartSec: 86,
      sequences: [{ id: "flow", from: 0, duration: 273, trimBefore: 2580, playbackRate: 1.1 }],
    });
    expect(host).toContain("import { AbsoluteFill, Composition, Freeze, OffthreadVideo, Sequence, staticFile, useCurrentFrame } from \"remotion\"");
    expect(host).toContain("<OffthreadVideo");
    expect(host).not.toContain("frame.png");
    expect(host).toMatch(/<Sequence from=\{0\} durationInFrames=\{273\} trimBefore=\{2580\}>/);
    expect(host).toMatch(/<SourceLock trimBefore=\{2580\} playbackRate=\{1\.1\}>/);
    expect(host).toContain('id="VideoHost"');
    expect(host).toContain("durationInFrames={273}");
  });
});

describe("stillHostSource", () => {
  it("passes trimBefore so still renders the source-aligned comp frame", () => {
    const host = stillHostSource({
      active: [{ ...flow, window: { startSec: 74.55, endSec: 121.18 } }],
      width: 640,
      height: 360,
      fps: 30,
      tSec: 90,
      sequences: [{ id: "flow", from: 0, duration: 1, trimBefore: 464, playbackRate: 1 }],
    });
    expect(host).toContain("import { AbsoluteFill, Composition, Img, Sequence, staticFile } from \"remotion\"");
    expect(host).toContain('staticFile("frame.png")');
    expect(host).toMatch(/<Sequence from=\{0\} durationInFrames=\{1\} trimBefore=\{464\}>/);
    expect(host).toContain('id="StillHost"');
    expect(host).toContain("durationInFrames={1}");
  });
});

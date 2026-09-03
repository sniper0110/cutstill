import { describe, expect, it } from "vitest";
import { videoHostSource } from "../src/lib/remotion/host.js";
import { planCompSequences } from "../src/lib/remotion/sequences.js";
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
    });
    expect(planned[0]!.duration).toBe(Math.round((10 / 1.1) * 30));
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
      { id: "flow", from: 0, duration: 30, trimBefore: 0 },
      { id: "flow", from: 30, duration: 30, trimBefore: 60 },
    ]);
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
      sequences: [{ id: "flow", from: 0, duration: 273, trimBefore: 2580 }],
    });
    expect(host).toContain("import { AbsoluteFill, Composition, OffthreadVideo, Sequence, staticFile } from \"remotion\"");
    expect(host).toContain("<OffthreadVideo");
    expect(host).not.toContain("frame.png");
    expect(host).toMatch(/<Sequence from=\{0\} durationInFrames=\{273\} trimBefore=\{2580\}>/);
    expect(host).toContain('id="VideoHost"');
    expect(host).toContain("durationInFrames={273}");
  });
});

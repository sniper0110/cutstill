import { describe, expect, it } from "vitest";
import {
  computeKeptRanges,
  mapSourceTime,
  mapSessionTime,
  outputDuration,
} from "../src/lib/time.js";
import { defaultTimeline } from "../src/lib/tools/types.js";

describe("computeKeptRanges — keep protects, it does not isolate", () => {
  it("keep 50–70 and cut 10–12 leaves 0–10 and 12–100, with 50–70 at rate 1", () => {
    const timeline = defaultTimeline();
    timeline.keeps = [{ startSec: 50, endSec: 70 }];
    timeline.removes = [{ startSec: 10, endSec: 12 }];
    timeline.speed = 1.25;

    const ranges = computeKeptRanges(100, timeline);

    expect(ranges.some((range) => range.startSec === 50 && range.endSec === 70 && range.rate === 1)).toBe(
      true,
    );
    expect(ranges.some((range) => range.startSec <= 0 + 1e-9 && range.endSec === 10)).toBe(true);
    expect(ranges.some((range) => range.startSec === 12)).toBe(true);
    expect(Math.max(...ranges.map((range) => range.endSec))).toBeCloseTo(100, 5);

    const covers = (t: number) => ranges.some((range) => t >= range.startSec && t < range.endSec);
    expect(covers(0)).toBe(true);
    expect(covers(9.9)).toBe(true);
    expect(covers(10.5)).toBe(false);
    expect(covers(12)).toBe(true);
    expect(covers(60)).toBe(true);
    expect(covers(99)).toBe(true);

    const onlyKeep = ranges.length === 1 && ranges[0]!.startSec === 50 && ranges[0]!.endSec === 70;
    expect(onlyKeep).toBe(false);
  });

  it("keep must not become the only remaining range", () => {
    const timeline = defaultTimeline();
    timeline.keeps = [{ startSec: 50, endSec: 70 }];
    const ranges = computeKeptRanges(100, timeline);
    const span = ranges.reduce((sum, range) => sum + (range.endSec - range.startSec), 0);
    expect(span).toBeCloseTo(100, 5);
    expect(ranges.some((range) => range.startSec <= 0 + 1e-9)).toBe(true);
    expect(Math.max(...ranges.map((range) => range.endSec))).toBeCloseTo(100, 5);
    expect(ranges.every((range) => range.startSec >= 50 && range.endSec <= 70)).toBe(false);
  });

  it("cuts that overlap a keep only remove the unprotected part", () => {
    const timeline = defaultTimeline();
    timeline.keeps = [{ startSec: 50, endSec: 70 }];
    timeline.removes = [{ startSec: 40, endSec: 80 }];
    const ranges = computeKeptRanges(100, timeline);
    expect(ranges.some((range) => range.startSec === 50 && range.endSec === 70 && range.rate === 1)).toBe(
      true,
    );
    const covers = (t: number) => ranges.some((range) => t >= range.startSec && t < range.endSec);
    expect(covers(39)).toBe(true);
    expect(covers(45)).toBe(false);
    expect(covers(60)).toBe(true);
    expect(covers(75)).toBe(false);
    expect(covers(90)).toBe(true);
  });

  it("keep forces 1.0× while the rest can be 1.1×", () => {
    const timeline = defaultTimeline();
    timeline.keeps = [{ startSec: 1, endSec: 2 }];
    timeline.removes = [{ startSec: 0.5, endSec: 1.5 }];
    timeline.speed = 1.1;
    const ranges = computeKeptRanges(3, timeline);
    const keep = ranges.find((range) => range.startSec === 1 && range.endSec === 2);
    expect(keep?.rate).toBe(1);
    expect(ranges.filter((range) => range.startSec < 1 || range.startSec >= 2).every((range) => range.rate === 1.1)).toBe(
      true,
    );
    const covers = (t: number) => ranges.some((range) => t >= range.startSec && t < range.endSec);
    expect(covers(0.2)).toBe(true);
    expect(covers(0.7)).toBe(false);
    expect(covers(1.2)).toBe(true);
    expect(covers(2.5)).toBe(true);
  });
});

describe("mapSourceTime through kept ranges + speed", () => {
  it("is identity when there are no cuts or speed", () => {
    expect(mapSourceTime(1.25)).toEqual({ tSec: 1.25, fileSec: 1.25 });
    expect(mapSourceTime(0)).toEqual({ tSec: 0, fileSec: 0 });
    const timeline = defaultTimeline();
    expect(mapSessionTime(0.8, 3, timeline)).toEqual({ tSec: 0.8, fileSec: 0.8 });
  });

  it("maps a source time after a middle cut to a smaller fileSec", () => {
    const timeline = defaultTimeline();
    timeline.removes = [{ startSec: 1, endSec: 2 }];
    const mapped = mapSessionTime(2.5, 3, timeline);
    expect(mapped.tSec).toBe(2.5);
    expect(mapped.fileSec).toBeCloseTo(1.5, 5);
    expect(mapped.fileSec).toBeLessThan(mapped.tSec);
  });

  it("speed 2× halves file time and output duration", () => {
    const timeline = defaultTimeline();
    timeline.speed = 2;
    const mapped = mapSessionTime(2.4, 3, timeline);
    expect(mapped.fileSec).toBeCloseTo(1.2, 5);
    expect(outputDuration(computeKeptRanges(3, timeline))).toBeCloseTo(1.5, 5);
  });
});

import { describe, expect, it } from "vitest";
import { mapSourceTime, mapSessionTime } from "../src/lib/time.js";
import { defaultTimeline } from "../src/lib/tools/types.js";

describe("mapSourceTime", () => {
  it("is identity when there are no cuts or speed", () => {
    expect(mapSourceTime(1.25)).toEqual({ tSec: 1.25, fileSec: 1.25 });
    expect(mapSourceTime(0)).toEqual({ tSec: 0, fileSec: 0 });
    expect(mapSessionTime(0.4, 3, defaultTimeline())).toEqual({ tSec: 0.4, fileSec: 0.4 });
  });
});

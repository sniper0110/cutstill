import { describe, expect, it } from "vitest";
import { mapSourceTime } from "../src/lib/time.js";

describe("mapSourceTime", () => {
  it("is identity until timeline tools exist", () => {
    expect(mapSourceTime(1.25)).toEqual({ tSec: 1.25, fileSec: 1.25 });
    expect(mapSourceTime(0)).toEqual({ tSec: 0, fileSec: 0 });
  });
});

import { describe, expect, it } from "vitest";
import { TOOLS_CATALOG_ID, V1_TOOL_NAMES, getToolsCatalog, isV1ToolName } from "../src/lib/tools/index.js";

describe("cutstill.tools.v1 catalog", () => {
  it("names the catalog and only the first-slice tools", () => {
    const catalog = getToolsCatalog();
    expect(catalog.schema).toBe("cutstill.tools.v1");
    expect(TOOLS_CATALOG_ID).toBe("cutstill.tools.v1");
    expect(catalog.tools.map((tool) => tool.name)).toEqual([...V1_TOOL_NAMES]);
    expect(V1_TOOL_NAMES).toEqual([
      "session.create",
      "session.get",
      "comp.upsert",
      "render.still",
      "media.transcribe",
    ]);
  });

  it("does not ship parked or kit tools", () => {
    const names = getToolsCatalog().tools.map((tool) => tool.name);
    expect(names).not.toContain("graphic.upsert");
    expect(names).not.toContain("encode.preview");
    expect(names).not.toContain("render.window");
    expect(names).not.toContain("render.publish");
    expect(names).not.toContain("comp.scaffold");
    expect(names).not.toContain("timeline.cut");
    expect(names).not.toContain("timeline.keep");
    expect(names).not.toContain("timeline.speed");
    expect(names).not.toContain("clip.fetch");
    expect(names).not.toContain("ave direct");
  });

  it("comp.upsert engine is remotion only", () => {
    const spec = getToolsCatalog().tools.find((tool) => tool.name === "comp.upsert");
    expect(spec?.input.properties?.engine?.const).toBe("remotion");
    expect(spec?.input.properties?.engine?.enum).toBeUndefined();
    expect(JSON.stringify(spec)).not.toMatch(/ffmpeg/);
  });

  it("recognizes only v1 names", () => {
    expect(isV1ToolName("render.still")).toBe(true);
    expect(isV1ToolName("graphic.upsert")).toBe(false);
  });
});

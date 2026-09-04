import { describe, expect, it } from "vitest";
import { TOOLS_CATALOG_ID, V1_TOOL_NAMES, getToolsCatalog, isV1ToolName } from "../src/lib/tools/index.js";

describe("cutstill.tools.v1 catalog", () => {
  it("names the catalog and the v1 tools", () => {
    const catalog = getToolsCatalog();
    expect(catalog.tools.every((tool) => tool.output.properties?.cost)).toBe(true);
    expect(catalog.schema).toBe("cutstill.tools.v1");
    expect(TOOLS_CATALOG_ID).toBe("cutstill.tools.v1");
    expect(catalog.tools.map((tool) => tool.name)).toEqual([...V1_TOOL_NAMES]);
    expect(V1_TOOL_NAMES).toEqual([
      "session.create",
      "session.get",
      "session.cost",
      "comp.upsert",
      "comp.remove",
      "render.still",
      "render.window",
      "render.publish",
      "media.transcribe",
      "timeline.cut",
      "timeline.keep",
      "timeline.speed",
      "timeline.layout",
      "fal.models",
      "fal.generate",
      "fal.status",
      "media.face",
      "timeline.cropFromTalent",
    ]);
  });

  it("does not ship parked or kit tools", () => {
    const names = getToolsCatalog().tools.map((tool) => tool.name);
    expect(names).not.toContain("graphic.upsert");
    expect(names).not.toContain("encode.preview");
    expect(names).not.toContain("comp.scaffold");
    expect(names).not.toContain("clip.fetch");
    expect(names).not.toContain("ave direct");
    expect(names).toContain("session.cost");
    expect(names).toContain("timeline.cut");
    expect(names).toContain("timeline.keep");
    expect(names).toContain("timeline.speed");
    expect(names).toContain("timeline.layout");
    expect(names).toContain("fal.models");
    expect(names).toContain("fal.generate");
    expect(names).toContain("fal.status");
    expect(names).toContain("media.face");
    expect(names).toContain("timeline.cropFromTalent");
    expect(names).not.toContain("fal.attach");
  });

  it("layout split is caller fractions with no baked 25/75 or brand copy", () => {
    const catalog = getToolsCatalog();
    const spec = catalog.tools.find((tool) => tool.name === "timeline.layout");
    expect(spec).toBeTruthy();
    const blob = JSON.stringify(spec);
    expect(blob).not.toMatch(/0\.25|0\.75|25\s*\/\s*75/);
    expect(blob.toLowerCase()).not.toContain("pycad");
    expect(blob.toLowerCase()).not.toContain("dental");
    expect(spec?.input.properties?.mode?.enum).toEqual(["split", "full", "crop", "stack"]);
    expect(spec?.input.properties?.split?.properties?.talent?.const).toBeUndefined();
    expect(spec?.input.properties?.split?.properties?.talent?.enum).toBeUndefined();
    expect(spec?.input.properties?.stack?.properties?.graphics?.const).toBeUndefined();
    expect(spec?.input.properties?.stack?.properties?.talent?.const).toBeUndefined();
    expect(spec?.input.properties?.captions).toBeTruthy();
    expect(spec?.input.properties?.captions?.items?.required).toEqual(["startSec", "endSec"]);
    expect(spec?.input.properties?.captions?.items?.properties?.words).toBeTruthy();
    expect(spec?.input.properties?.bandHeight).toBeTruthy();
    expect(spec?.input.properties?.captionFontSize).toBeTruthy();
    expect(spec?.input.properties?.palette?.description).toMatch(/captionActive/);
    expect(spec?.input.properties?.width?.description).toMatch(/1080/);
    expect(spec?.input.properties?.height?.description).toMatch(/1920/);
    expect(JSON.stringify(catalog).toLowerCase()).not.toContain("encode.preview");
  });

  it("comp.upsert engine is remotion only", () => {
    const spec = getToolsCatalog().tools.find((tool) => tool.name === "comp.upsert");
    expect(spec?.input.properties?.engine?.const).toBe("remotion");
    expect(spec?.input.properties?.engine?.enum).toBeUndefined();
    expect(JSON.stringify(spec)).not.toMatch(/ffmpeg/);
  });

  it("recognizes only v1 names", () => {
    expect(isV1ToolName("session.cost")).toBe(true);
    expect(isV1ToolName("comp.remove")).toBe(true);
    expect(isV1ToolName("render.still")).toBe(true);
    expect(isV1ToolName("render.window")).toBe(true);
    expect(isV1ToolName("render.publish")).toBe(true);
    expect(isV1ToolName("timeline.cut")).toBe(true);
    expect(isV1ToolName("timeline.keep")).toBe(true);
    expect(isV1ToolName("timeline.speed")).toBe(true);
    expect(isV1ToolName("timeline.layout")).toBe(true);
    expect(isV1ToolName("fal.models")).toBe(true);
    expect(isV1ToolName("fal.generate")).toBe(true);
    expect(isV1ToolName("fal.status")).toBe(true);
    expect(isV1ToolName("media.face")).toBe(true);
    expect(isV1ToolName("timeline.cropFromTalent")).toBe(true);
    expect(isV1ToolName("fal.attach")).toBe(false);
    expect(isV1ToolName("encode.preview")).toBe(false);
    expect(isV1ToolName("graphic.upsert")).toBe(false);
  });
});

import { TOOLS_CATALOG_ID, V1_TOOL_NAMES, type JsonSchema, type ToolSpec, type ToolsCatalog } from "./types.js";

export { TOOLS_CATALOG_ID, V1_TOOL_NAMES };

const SESSION_ID: JsonSchema = { type: "string", description: "Session id returned by session.create" };
const SOURCE_SEC: JsonSchema = { type: "number", description: "Time in source seconds" };

const COMMON_ERRORS = [
  { code: "INVALID_INPUT", description: "Required field missing or wrong type" },
  { code: "SESSION_NOT_FOUND", description: "No session with that sessionId" },
  { code: "TOOL_FAILED", description: "Handler failed" },
];

function tool(
  name: ToolSpec["name"],
  description: string,
  input: JsonSchema,
  output: JsonSchema,
  extraErrors: ToolSpec["errors"] = [],
): ToolSpec {
  return { name, description, input, output, errors: [...COMMON_ERRORS, ...extraErrors] };
}

const SESSION_SNAPSHOT: JsonSchema = {
  type: "object",
  additionalProperties: true,
  properties: {
    sessionId: { type: "string" },
    sourcePath: { type: "string" },
    briefPath: { type: "string" },
    comps: { type: "array", items: { type: "object", additionalProperties: true } },
    timeline: { type: "object", additionalProperties: true },
    usage: { type: "array", items: { type: "object", additionalProperties: true } },
  },
};

export const TOOL_SPECS: ToolSpec[] = [
  tool(
    "session.create",
    "Create a session from a local source file. Optional brief is stored as copy; tools do not parse it for graphics.",
    {
      type: "object",
      required: ["sourcePath"],
      additionalProperties: false,
      properties: {
        sourcePath: { type: "string", description: "Local media file path" },
        briefPath: { type: "string", description: "Optional notes file. Stored verbatim, never parsed." },
      },
    },
    {
      type: "object",
      required: ["sessionId", "sourcePath", "paths"],
      properties: {
        sessionId: { type: "string" },
        sourcePath: { type: "string" },
        briefPath: { type: "string" },
        comps: { type: "array" },
        usage: { type: "array" },
        paths: { type: "object", additionalProperties: { type: "string" } },
      },
    },
    [{ code: "MEDIA_NOT_FOUND", description: "sourcePath does not exist" }],
  ),
  tool(
    "session.get",
    "Return the persisted session snapshot, including comps and usage.",
    { type: "object", required: ["sessionId"], additionalProperties: false, properties: { sessionId: SESSION_ID } },
    SESSION_SNAPSHOT,
  ),
  tool(
    "comp.upsert",
    "Write or patch a Remotion composition (TSX) into the session comps folder. engine must be remotion.",
    {
      type: "object",
      required: ["sessionId", "id", "engine", "source", "window"],
      additionalProperties: false,
      properties: {
        sessionId: SESSION_ID,
        id: { type: "string", description: "Composition id (letter, then letters/digits/_/-)" },
        engine: { type: "string", const: "remotion", description: "Only remotion in this slice" },
        source: { type: "string", description: "TSX module that default-exports a React component" },
        window: {
          type: "object",
          required: ["startSec", "endSec"],
          additionalProperties: false,
          properties: { startSec: SOURCE_SEC, endSec: SOURCE_SEC },
        },
        props: { type: "object", additionalProperties: true, description: "Injected into the composition. No baked theme." },
      },
    },
    {
      type: "object",
      required: ["comp", "comps"],
      properties: {
        comp: { type: "object", additionalProperties: true },
        comps: { type: "array", items: { type: "object", additionalProperties: true } },
      },
    },
    [
      { code: "UNSUPPORTED_ENGINE", description: "Only engine remotion is accepted in this slice" },
      { code: "SANDBOX_VIOLATION", description: "Composition source failed the session sandbox" },
    ],
  ),
  tool(
    "comp.remove",
    "Remove a composition from the session by id. Persisted; later stills and session.get no longer include it.",
    {
      type: "object",
      required: ["sessionId", "id"],
      additionalProperties: false,
      properties: {
        sessionId: SESSION_ID,
        id: { type: "string", description: "Composition id previously passed to comp.upsert" },
      },
    },
    {
      type: "object",
      required: ["removed", "comps"],
      properties: {
        removed: { type: "string" },
        comps: { type: "array", items: { type: "object", additionalProperties: true } },
      },
    },
    [{ code: "COMP_NOT_FOUND", description: "No composition with that id in the session" }],
  ),
  tool(
    "render.still",
    "Render a PNG still at a source time: source frame plus Remotion comps whose window covers t. Default iteration unit.",
    {
      type: "object",
      required: ["sessionId", "tSec"],
      additionalProperties: false,
      properties: {
        sessionId: SESSION_ID,
        tSec: SOURCE_SEC,
      },
    },
    {
      type: "object",
      required: ["path", "tSec", "fileSec", "compsActive", "width", "height"],
      properties: {
        path: { type: "string" },
        tSec: { type: "number" },
        fileSec: { type: "number" },
        compsActive: { type: "array", items: { type: "string" } },
        width: { type: "number" },
        height: { type: "number" },
      },
    },
  ),
  tool(
    "render.window",
    "Render a short mp4 of the same composite stack as render.still for a source range (capped at 12s). Motion/crop check — not the cheap default.",
    {
      type: "object",
      required: ["sessionId", "startSec", "endSec"],
      additionalProperties: false,
      properties: {
        sessionId: SESSION_ID,
        startSec: SOURCE_SEC,
        endSec: SOURCE_SEC,
      },
    },
    {
      type: "object",
      required: ["path", "posterPath", "startSec", "endSec", "durationSec", "compsActive", "width", "height"],
      properties: {
        path: { type: "string" },
        posterPath: { type: "string" },
        startSec: { type: "number" },
        endSec: { type: "number" },
        durationSec: { type: "number" },
        compsActive: { type: "array", items: { type: "string" } },
        width: { type: "number" },
        height: { type: "number" },
        hasAudio: { type: "boolean" },
      },
    },
  ),
  tool(
    "render.publish",
    "Publish the full cut: 1080p or source size if smaller, plus audio when the source has audio. Once — not the iteration default.",
    {
      type: "object",
      required: ["sessionId"],
      additionalProperties: false,
      properties: {
        sessionId: SESSION_ID,
        outPath: { type: "string", description: "Optional output mp4 path. Default sessions/<id>/publish.mp4" },
      },
    },
    {
      type: "object",
      required: ["path", "posterPath", "durationSec", "width", "height", "hasAudio"],
      properties: {
        path: { type: "string" },
        posterPath: { type: "string" },
        durationSec: { type: "number" },
        width: { type: "number" },
        height: { type: "number" },
        hasAudio: { type: "boolean" },
      },
    },
  ),
  tool(
    "media.transcribe",
    "Word-level transcript of the session source. Cached by source hash. Live vendor only when a key is present; tests use a stub.",
    { type: "object", required: ["sessionId"], additionalProperties: false, properties: { sessionId: SESSION_ID } },
    {
      type: "object",
      required: ["language", "durationSec", "words"],
      properties: {
        language: { type: "string" },
        durationSec: { type: "number" },
        words: {
          type: "array",
          items: {
            type: "object",
            required: ["text", "startSec", "endSec"],
            properties: {
              text: { type: "string" },
              startSec: { type: "number" },
              endSec: { type: "number" },
              confidence: { type: "number" },
            },
          },
        },
        utterances: { type: "array", items: { type: "object", additionalProperties: true } },
        cached: { type: "boolean" },
      },
    },
  ),
  tool(
    "timeline.cut",
    "Remove a source-second range from the session timeline.",
    {
      type: "object",
      required: ["sessionId", "startSec", "endSec"],
      additionalProperties: false,
      properties: { sessionId: SESSION_ID, startSec: SOURCE_SEC, endSec: SOURCE_SEC },
    },
    SESSION_SNAPSHOT,
  ),
  tool(
    "timeline.keep",
    "Protect a source-second window: exempt from timeline.cut, play at 1.0×. Source outside the window stays unless explicitly cut.",
    {
      type: "object",
      required: ["sessionId", "startSec", "endSec"],
      additionalProperties: false,
      properties: { sessionId: SESSION_ID, startSec: SOURCE_SEC, endSec: SOURCE_SEC },
    },
    SESSION_SNAPSHOT,
  ),
  tool(
    "timeline.speed",
    "Set playback rate globally or on a source-second window.",
    {
      type: "object",
      required: ["sessionId", "rate"],
      additionalProperties: false,
      properties: {
        sessionId: SESSION_ID,
        rate: { type: "number", minimum: 0.1, description: "Playback rate (1 = unchanged)" },
        startSec: SOURCE_SEC,
        endSec: SOURCE_SEC,
      },
    },
    SESSION_SNAPSHOT,
  ),
  tool(
    "timeline.layout",
    "Set canvas layout. split is landscape side-by-side; stack is portrait shorts (upper graphics, lower talking-head crop, default 1080×1920). Fractions and captions are caller-supplied.",
    {
      type: "object",
      required: ["sessionId", "mode"],
      additionalProperties: false,
      properties: {
        sessionId: SESSION_ID,
        mode: { type: "string", enum: ["split", "full", "crop", "stack"] },
        split: {
          type: "object",
          additionalProperties: false,
          properties: {
            talent: { type: "number", description: "Primary pane fraction 0–1 (caller-supplied)" },
            graphics: { type: "number", description: "Secondary pane fraction 0–1 (caller-supplied)" },
            dividerPx: { type: "number" },
          },
        },
        stack: {
          type: "object",
          additionalProperties: false,
          properties: {
            graphics: { type: "number", description: "Upper pane fraction 0–1 (caller-supplied)" },
            talent: { type: "number", description: "Lower talking-head pane fraction 0–1 (caller-supplied)" },
          },
        },
        crop: {
          type: "object",
          additionalProperties: false,
          properties: {
            x: { type: "number" },
            y: { type: "number" },
            width: { type: "number" },
            height: { type: "number" },
          },
        },
        width: { type: "number", description: "Optional canvas width. Stack defaults to 1080 when omitted." },
        height: { type: "number", description: "Optional canvas height. Stack defaults to 1920 when omitted." },
        captions: {
          type: "array",
          description: "Optional midline caption cues in source seconds. Replaces the session caption list when passed.",
          items: {
            type: "object",
            required: ["text", "startSec", "endSec"],
            additionalProperties: false,
            properties: {
              text: { type: "string" },
              startSec: SOURCE_SEC,
              endSec: SOURCE_SEC,
            },
          },
        },
        palette: {
          type: "object",
          additionalProperties: true,
          description: "Session palette. Caller-supplied; no baked brand. caption / captionBand style the seam strip.",
        },
      },
    },
    SESSION_SNAPSHOT,
  ),
];

export function getToolsCatalog(): ToolsCatalog {
  return { schema: TOOLS_CATALOG_ID, tools: TOOL_SPECS };
}

export function listToolNames(): string[] {
  return [...V1_TOOL_NAMES];
}

export function isV1ToolName(name: string): name is ToolSpec["name"] {
  return (V1_TOOL_NAMES as readonly string[]).includes(name);
}

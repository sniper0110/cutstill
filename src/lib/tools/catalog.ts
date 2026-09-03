import { TOOLS_CATALOG_ID, V1_TOOL_NAMES, type JsonSchema, type ToolSpec, type ToolsCatalog } from "./types.js";

export { TOOLS_CATALOG_ID, V1_TOOL_NAMES };

const SESSION_ID: JsonSchema = { type: "string", description: "Session id returned by session.create" };
const SOURCE_SEC: JsonSchema = { type: "number", description: "Time in source seconds" };

const COMMON_ERRORS = [
  { code: "INVALID_INPUT", description: "Required field missing or wrong type" },
  { code: "SESSION_NOT_FOUND", description: "No session with that sessionId" },
  { code: "TOOL_FAILED", description: "Handler failed" },
];

const COST_OBJECT: JsonSchema = {
  type: "object",
  required: ["costUsd", "currency", "sessionTotalUsd"],
  properties: {
    costUsd: { type: "number", description: "USD for this call" },
    currency: { type: "string", const: "USD" },
    sessionTotalUsd: { type: "number", description: "Sum of usage[].costUsd after this call" },
  },
};

function tool(
  name: ToolSpec["name"],
  description: string,
  input: JsonSchema,
  output: JsonSchema,
  extraErrors: ToolSpec["errors"] = [],
): ToolSpec {
  return {
    name,
    description,
    input,
    output: {
      ...output,
      properties: { ...output.properties, cost: COST_OBJECT },
    },
    errors: [...COMMON_ERRORS, ...extraErrors],
  };
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
    "Return the persisted session snapshot, including comps, usage, and cost totals.",
    { type: "object", required: ["sessionId"], additionalProperties: false, properties: { sessionId: SESSION_ID } },
    SESSION_SNAPSHOT,
  ),
  tool(
    "session.cost",
    "Session price rollup for the calling agent. totalUsd is sum of usage[].costUsd. byTool groups count and spend. entries is the usage log.",
    { type: "object", required: ["sessionId"], additionalProperties: false, properties: { sessionId: SESSION_ID } },
    {
      type: "object",
      required: ["currency", "totalUsd", "byTool", "entries"],
      properties: {
        currency: { type: "string", const: "USD" },
        totalUsd: { type: "number" },
        byTool: { type: "object", additionalProperties: { type: "object" } },
        entries: { type: "array" },
      },
    },
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
    "Remove a source-second range from the session timeline. Range must lie within the source duration.",
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
          description: "Source crop rect. Under mode=stack this crops the lower talking-head pane (cover). Under mode=crop it crops the full canvas.",
          properties: {
            x: { type: "number" },
            y: { type: "number" },
            width: { type: "number" },
            height: { type: "number" },
          },
        },
        width: { type: "number", description: "Optional canvas width. Stack defaults to 1080 when omitted." },
        height: { type: "number", description: "Optional canvas height. Stack defaults to 1920 when omitted." },
        bandHeight: {
          type: "number",
          description: "Opaque midline caption band height in px. Default 64. Caller-overridable; use this for a real band, not floating text.",
        },
        captionFontSize: {
          type: "number",
          description: "Caption type size in px. Default 42.",
        },
        captions: {
          type: "array",
          description: "Optional midline caption cues in source seconds. Replaces the session caption list when passed. Line form: { text, startSec, endSec }. Karaoke: add words: [{ text, startSec, endSec }].",
          items: {
            type: "object",
            required: ["startSec", "endSec"],
            additionalProperties: false,
            properties: {
              text: { type: "string", description: "Full line. Optional when words is set (joined from words)." },
              startSec: SOURCE_SEC,
              endSec: SOURCE_SEC,
              words: {
                type: "array",
                description: "Optional karaoke words. The word covering the current source second uses palette.captionActive.",
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
            },
          },
        },
        palette: {
          type: "object",
          additionalProperties: true,
          description: "Session palette. Caller-supplied; no baked brand. caption / captionBand style the seam strip. captionActive is the karaoke highlight for the word covering tSec. divider draws the stack seam line.",
        },
      },
    },
    SESSION_SNAPSHOT,
  ),
  tool(
    "fal.models",
    "List Fal model ids wired in this Cutstill slice. Live calls need FAL_KEY in the environment.",
    { type: "object", additionalProperties: false, properties: {} },
    {
      type: "object",
      required: ["models"],
      properties: {
        models: {
          type: "array",
          items: {
            type: "object",
            properties: {
              id: { type: "string" },
              kind: { type: "string" },
            },
          },
        },
      },
    },
  ),
  tool(
    "fal.generate",
    "Submit a Fal video job (Seedance 2.5). Returns jobId immediately. Poll fal.status. generate_audio defaults false for shorts under talk. Assets write under sessions/<id>/fal/. Set FAL_KEY. No fal.attach in this slice.",
    {
      type: "object",
      required: ["modelId", "prompt"],
      additionalProperties: false,
      properties: {
        sessionId: SESSION_ID,
        modelId: {
          type: "string",
          enum: [
            "bytedance/seedance-2.5/text-to-video",
            "bytedance/seedance-2.5/image-to-video",
            "bytedance/seedance-2.5/reference-to-video",
          ],
        },
        prompt: { type: "string", description: "Generation prompt" },
        image_url: { type: "string", description: "Start frame URL for image-to-video (or first reference)" },
        end_image_url: { type: "string", description: "Optional end frame URL" },
        resolution: { type: "string", enum: ["480p", "720p"], description: "480p faster, 720p default" },
        duration: { type: "number", minimum: 4, maximum: 30, description: "Seconds, 4–30" },
        aspect_ratio: {
          type: "string",
          enum: ["auto", "21:9", "16:9", "4:3", "1:1", "3:4", "9:16"],
        },
        generate_audio: {
          type: "boolean",
          description: "Default false for shorts under talk. Fal default is true; Cutstill sends false unless set.",
        },
        outPath: { type: "string", description: "Optional destination mp4. Default sessions/<id>/fal/<jobId>.mp4" },
      },
    },
    {
      type: "object",
      required: ["jobId", "status"],
      properties: {
        jobId: { type: "string" },
        status: { type: "string" },
        path: { type: "string" },
        width: { type: "number" },
        height: { type: "number" },
        durationSec: { type: "number" },
        costUsd: { type: "number" },
      },
    },
    [{ code: "FAL_AUTH", description: "FAL_KEY missing or Fal returned 401" }],
  ),
  tool(
    "fal.status",
    "Poll a Fal job. When completed, download the mp4 onto disk (session fal/ or outPath) and return path.",
    {
      type: "object",
      required: ["jobId"],
      additionalProperties: false,
      properties: {
        sessionId: SESSION_ID,
        jobId: { type: "string", description: "jobId from fal.generate" },
      },
    },
    {
      type: "object",
      required: ["jobId", "status"],
      properties: {
        jobId: { type: "string" },
        status: { type: "string" },
        path: { type: "string" },
        width: { type: "number" },
        height: { type: "number" },
        durationSec: { type: "number" },
        costUsd: { type: "number" },
      },
    },
    [{ code: "FAL_AUTH", description: "FAL_KEY missing or Fal returned 401" }],
  ),
  tool(
    "media.face",
    "Sample the source with MediaPipe Pose Landmarker Lite and return a stable face+chest box. Pass startSec/endSec (or tSec) for the active short. When omitted, samples the session keep/cut remaining spans — never the cut opener if keeps/cuts exclude it.",
    {
      type: "object",
      required: ["sessionId"],
      additionalProperties: false,
      properties: {
        sessionId: SESSION_ID,
        tSec: SOURCE_SEC,
        startSec: { type: "number", description: "Sample window start in source seconds. Prefer this for a short (e.g. 74.6)." },
        endSec: { type: "number", description: "Sample window end in source seconds (e.g. 122.58)." },
        sampleEverySec: { type: "number", description: "Spacing between samples. Default 0.5. Ignored when tSec is set." },
        maxSamples: { type: "number", description: "Max frames to sample. Default 8." },
      },
    },
    {
      type: "object",
      required: ["x", "y", "width", "height", "normalized", "confidence", "sampleCount"],
      properties: {
        x: { type: "number" },
        y: { type: "number" },
        width: { type: "number" },
        height: { type: "number" },
        normalized: {
          type: "object",
          properties: {
            x: { type: "number" },
            y: { type: "number" },
            width: { type: "number" },
            height: { type: "number" },
          },
        },
        confidence: { type: "number" },
        sampleCount: { type: "number" },
        sampledSec: { type: "array", items: { type: "number" }, description: "Source seconds that were sampled" },
        sourceWidth: { type: "number" },
        sourceHeight: { type: "number" },
      },
    },
    [{ code: "FACE_NOT_FOUND", description: "No pose/face in sampled frames" }],
  ),
  tool(
    "timeline.cropFromTalent",
    "Write layout.crop so the face center maps to the lower-pane anchor. zoom=1 + existing crop: keep that w/h/y, slide X only. zoom=1 with no prior crop: cover-sized window. zoom>1 tightens from cover. Optional box override skips a new detect.",
    {
      type: "object",
      required: ["sessionId"],
      additionalProperties: false,
      properties: {
        sessionId: SESSION_ID,
        target: {
          description: "Pane anchor. \"center\" or { anchorX, anchorY } in 0–1.",
        },
        zoom: {
          type: "number",
          description: "1 = preserve existing crop w/h/y and recenter X. If no prior crop, use cover size. >1 tightens from cover.",
        },
        startSec: { type: "number", description: "If re-detecting, sample window start (same as media.face)" },
        endSec: { type: "number", description: "If re-detecting, sample window end" },
        box: {
          type: "object",
          description: "Optional face+chest box override (source pixels, or 0–1 fractions).",
          properties: {
            x: { type: "number" },
            y: { type: "number" },
            width: { type: "number" },
            height: { type: "number" },
          },
        },
        tSec: SOURCE_SEC,
        sampleEverySec: { type: "number" },
        maxSamples: { type: "number" },
      },
    },
    SESSION_SNAPSHOT,
    [{ code: "FACE_NOT_FOUND", description: "No pose/face in sampled frames" }],
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

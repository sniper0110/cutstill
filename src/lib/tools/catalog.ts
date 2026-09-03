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

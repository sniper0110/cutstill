export const TOOLS_CATALOG_ID = "cutstill.tools.v1";

export const V1_TOOL_NAMES = [
  "session.create",
  "session.get",
  "comp.upsert",
  "render.still",
  "render.window",
  "render.publish",
  "media.transcribe",
] as const;

export type V1ToolName = (typeof V1_TOOL_NAMES)[number];

export interface SourceRange {
  startSec: number;
  endSec: number;
}

export interface SessionComp {
  id: string;
  engine: "remotion";
  sourcePath: string;
  window: SourceRange;
  props: Record<string, unknown>;
}

export interface UsageEvent {
  action: string;
  at: number;
  costUsd: number;
  estimated: boolean;
  metadata?: Record<string, unknown>;
}

export interface TranscriptWord {
  text: string;
  startSec: number;
  endSec: number;
  confidence?: number;
}

export interface TranscriptUtterance {
  text: string;
  startSec: number;
  endSec: number;
  speaker?: string;
}

export interface SessionTranscript {
  language: string;
  durationSec: number;
  words: TranscriptWord[];
  utterances?: TranscriptUtterance[];
  sourceHash?: string;
}

export interface ToolSession {
  sessionId: string;
  sourcePath: string;
  briefPath?: string;
  briefCopy?: string;
  comps: SessionComp[];
  transcript?: SessionTranscript;
  usage: UsageEvent[];
  createdAt: number;
  updatedAt: number;
}

export interface ToolsTranscribeResult extends SessionTranscript {
  cached?: boolean;
}

export interface ToolsContext {
  sessionsRoot: string;
  transcribe?: (filePath: string, durationSeconds: number) => Promise<ToolsTranscribeResult>;
  now?: () => number;
  skipNetwork?: boolean;
}

export interface JsonSchema {
  type?: string | string[];
  description?: string;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  additionalProperties?: boolean | JsonSchema;
  items?: JsonSchema;
  enum?: unknown[];
  const?: unknown;
  minimum?: number;
  minItems?: number;
  minLength?: number;
}

export interface ToolErrorSpec {
  code: string;
  description: string;
}

export interface ToolSpec {
  name: V1ToolName;
  description: string;
  input: JsonSchema;
  output: JsonSchema;
  errors: ToolErrorSpec[];
}

export interface ToolsCatalog {
  schema: typeof TOOLS_CATALOG_ID;
  tools: ToolSpec[];
}

export interface RenderStillResult {
  path: string;
  tSec: number;
  fileSec: number;
  compsActive: string[];
  width: number;
  height: number;
}

export interface RenderWindowResult {
  path: string;
  posterPath: string;
  startSec: number;
  endSec: number;
  durationSec: number;
  compsActive: string[];
  width: number;
  height: number;
  hasAudio: boolean;
}

export interface RenderPublishResult {
  path: string;
  posterPath: string;
  durationSec: number;
  width: number;
  height: number;
  hasAudio: boolean;
}

export interface McpImageContent {
  type: "image";
  data: string;
  mimeType: "image/png";
}

export interface McpTextContent {
  type: "text";
  text: string;
}

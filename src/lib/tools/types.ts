export const TOOLS_CATALOG_ID = "cutstill.tools.v1";

export const V1_TOOL_NAMES = [
  "session.create",
  "session.get",
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
] as const;

export type V1ToolName = (typeof V1_TOOL_NAMES)[number];

export interface SourceRange {
  startSec: number;
  endSec: number;
}

export type LayoutMode = "split" | "full" | "crop" | "stack";

export interface SpeedWindow extends SourceRange {
  rate: number;
}

export interface SplitLayout {
  talent: number;
  graphics: number;
  dividerPx?: number;
}

export interface CropLayout {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Portrait shorts: upper graphics pane, lower talking-head crop. Fractions are caller-supplied. */
export interface StackLayout {
  graphics: number;
  talent: number;
}

export interface SessionCaption {
  text: string;
  startSec: number;
  endSec: number;
}

export interface SessionLayout {
  mode: LayoutMode;
  split?: SplitLayout;
  stack?: StackLayout;
  crop?: CropLayout;
  palette?: Record<string, string>;
  captions?: SessionCaption[];
  /** Optional override. Stack defaults to 1080×1920 when omitted. */
  width?: number;
  height?: number;
}

export interface SessionTimeline {
  removes: SourceRange[];
  /** Protected source windows: not isolated. Exempt from cuts; forced to 1.0×. */
  keeps: SourceRange[];
  speed: number;
  speedWindows: SpeedWindow[];
  layout: SessionLayout;
}

export function defaultTimeline(): SessionTimeline {
  return {
    removes: [],
    keeps: [],
    speed: 1,
    speedWindows: [],
    layout: { mode: "full" },
  };
}

export function normalizeTimeline(raw: Partial<SessionTimeline> | undefined): SessionTimeline {
  const base = defaultTimeline();
  if (!raw || typeof raw !== "object") return base;
  return {
    removes: Array.isArray(raw.removes) ? raw.removes : [],
    keeps: Array.isArray(raw.keeps) ? raw.keeps : [],
    speed: typeof raw.speed === "number" && raw.speed > 0 ? raw.speed : 1,
    speedWindows: Array.isArray(raw.speedWindows) ? raw.speedWindows : [],
    layout: {
      mode:
        raw.layout?.mode === "split" ||
        raw.layout?.mode === "crop" ||
        raw.layout?.mode === "stack"
          ? raw.layout.mode
          : "full",
      split: raw.layout?.split,
      stack: raw.layout?.stack,
      crop: raw.layout?.crop,
      palette: raw.layout?.palette ?? {},
      captions: Array.isArray(raw.layout?.captions) ? raw.layout.captions : [],
      width: typeof raw.layout?.width === "number" && raw.layout.width > 0 ? raw.layout.width : undefined,
      height: typeof raw.layout?.height === "number" && raw.layout.height > 0 ? raw.layout.height : undefined,
    },
  };
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
  timeline: SessionTimeline;
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

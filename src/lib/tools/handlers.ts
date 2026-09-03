import { existsSync } from "node:fs";
import { readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { layoutCanvasSize } from "../layout.js";
import { probeMediaMetadata } from "../probe.js";
import {
  clampWindow,
  publishSize,
  renderSessionMedia,
  renderSessionStill,
  stillFileName,
  windowFileStem,
} from "../remotion/engine.js";
import { assertCompId, assertSandboxSource } from "../sandbox.js";
import { mapSessionTime } from "../time.js";
import { transcribeSource } from "../transcribe/index.js";
import {
  asRecord,
  optionalNumber,
  optionalRecord,
  optionalString,
  requireNumber,
  requireString,
  ToolError,
} from "./errors.js";
import {
  createSessionRecord,
  mutateSession,
  publicSession,
  readSession,
  resolveSessionsRoot,
  sessionPaths,
} from "./store.js";
import type { SessionCaption, SessionCaptionWord, SessionComp, SessionLayout, ToolSession, ToolsContext } from "./types.js";

function parseCaptionWord(raw: unknown, path: string): SessionCaptionWord {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new ToolError("INVALID_INPUT", `${path} must be an object`);
  }
  const item = raw as Record<string, unknown>;
  const text = requireString(item.text, `${path}.text`);
  const startSec = requireNumber(item.startSec, `${path}.startSec`);
  const endSec = requireNumber(item.endSec, `${path}.endSec`);
  if (endSec <= startSec) {
    throw new ToolError("INVALID_INPUT", `${path}.endSec must be greater than startSec`);
  }
  return { text, startSec, endSec };
}

function parseCaption(raw: unknown, index: number): SessionCaption {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new ToolError("INVALID_INPUT", `captions[${index}] must be an object`);
  }
  const item = raw as Record<string, unknown>;
  const words = Array.isArray(item.words)
    ? item.words.map((word, wordIndex) => parseCaptionWord(word, `captions[${index}].words[${wordIndex}]`))
    : undefined;
  const text =
    optionalString(item.text) ??
    (words && words.length > 0 ? words.map((word) => word.text).join(" ") : "");
  if (!text) {
    throw new ToolError("INVALID_INPUT", `captions[${index}] needs text or words`);
  }
  const startSec =
    optionalNumber(item.startSec) ?? (words && words.length > 0 ? words[0]!.startSec : undefined);
  const endSec =
    optionalNumber(item.endSec) ??
    (words && words.length > 0 ? words[words.length - 1]!.endSec : undefined);
  if (startSec == null) throw new ToolError("INVALID_INPUT", `captions[${index}].startSec is required`);
  if (endSec == null) throw new ToolError("INVALID_INPUT", `captions[${index}].endSec is required`);
  if (endSec <= startSec) {
    throw new ToolError("INVALID_INPUT", `captions[${index}].endSec must be greater than startSec`);
  }
  return { text, startSec, endSec, ...(words && words.length > 0 ? { words } : {}) };
}

function ctxRoot(ctx: ToolsContext): string {
  return resolveSessionsRoot(ctx);
}

async function load(ctx: ToolsContext, sessionId: string): Promise<ToolSession> {
  return readSession(ctxRoot(ctx), requireString(sessionId, "sessionId"));
}

function snapshot(ctx: ToolsContext, session: ToolSession) {
  return publicSession(session, ctxRoot(ctx));
}

function recordUsage(session: ToolSession, action: string, metadata?: Record<string, unknown>): void {
  session.usage = [
    ...session.usage,
    {
      action,
      at: Date.now(),
      costUsd: 0,
      estimated: true,
      metadata,
    },
  ];
}

export async function sessionCreate(input: unknown, ctx: ToolsContext) {
  const rec = asRecord(input);
  const sourcePath = path.resolve(requireString(rec.sourcePath, "sourcePath"));
  if (!existsSync(sourcePath)) {
    throw new ToolError("MEDIA_NOT_FOUND", `sourcePath does not exist: ${sourcePath}`);
  }
  const briefPath = optionalString(rec.briefPath);
  let briefCopy: string | undefined;
  if (briefPath) {
    const resolved = path.resolve(briefPath);
    if (!existsSync(resolved)) {
      throw new ToolError("MEDIA_NOT_FOUND", `briefPath does not exist: ${resolved}`);
    }
    briefCopy = await readFile(resolved, "utf8");
  }
  const session = await createSessionRecord(ctx, { sourcePath, briefPath, briefCopy });
  return snapshot(ctx, session);
}

export async function sessionGet(input: unknown, ctx: ToolsContext) {
  const rec = asRecord(input);
  const session = await load(ctx, requireString(rec.sessionId, "sessionId"));
  return snapshot(ctx, session);
}

export async function compUpsert(input: unknown, ctx: ToolsContext) {
  const rec = asRecord(input);
  const sessionId = requireString(rec.sessionId, "sessionId");
  const id = assertCompId(requireString(rec.id, "id"));
  const engine = requireString(rec.engine, "engine");
  if (engine !== "remotion") {
    throw new ToolError("UNSUPPORTED_ENGINE", "this slice only accepts engine: remotion");
  }
  const source = requireString(rec.source, "source");
  assertSandboxSource(source);
  if (!rec.window || typeof rec.window !== "object") {
    throw new ToolError("INVALID_INPUT", "window is required");
  }
  const windowRec = rec.window as Record<string, unknown>;
  const window = {
    startSec: requireNumber(windowRec.startSec, "window.startSec"),
    endSec: requireNumber(windowRec.endSec, "window.endSec"),
  };
  if (window.endSec <= window.startSec) {
    throw new ToolError("INVALID_INPUT", "window.endSec must be greater than window.startSec");
  }
  const props = optionalRecord(rec.props);
  const session = await load(ctx, sessionId);
  const dest = path.join(sessionPaths(ctxRoot(ctx), session.sessionId).comps, `${id}.tsx`);
  await writeFile(dest, source.endsWith("\n") ? source : `${source}\n`, "utf8");
  const comp: SessionComp = {
    id,
    engine: "remotion",
    sourcePath: dest,
    window,
    props,
  };
  const next = await mutateSession(ctx, sessionId, (current) => {
    const index = current.comps.findIndex((item) => item.id === id);
    if (index >= 0) current.comps[index] = comp;
    else current.comps.push(comp);
    recordUsage(current, "comp.upsert", { id });
    return current;
  });
  return { comp, comps: next.comps };
}

export async function compRemove(input: unknown, ctx: ToolsContext) {
  const rec = asRecord(input);
  const sessionId = requireString(rec.sessionId, "sessionId");
  const id = assertCompId(requireString(rec.id, "id"));
  const session = await load(ctx, sessionId);
  const existing = session.comps.find((item) => item.id === id);
  if (!existing) {
    throw new ToolError("COMP_NOT_FOUND", `composition not found: ${id}`);
  }
  const dest = existing.sourcePath;
  if (dest && existsSync(dest)) {
    await unlink(dest);
  }
  const next = await mutateSession(ctx, sessionId, (current) => {
    current.comps = current.comps.filter((item) => item.id !== id);
    recordUsage(current, "comp.remove", { id });
    return current;
  });
  return { removed: id, comps: next.comps };
}

export async function renderStill(input: unknown, ctx: ToolsContext) {
  const rec = asRecord(input);
  const session = await load(ctx, requireString(rec.sessionId, "sessionId"));
  const tSec = requireNumber(rec.tSec, "tSec");
  const probed = await probeMediaMetadata(session.sourcePath);
  const mapped = mapSessionTime(tSec, probed.durationSeconds, session.timeline);
  const dest = path.join(sessionPaths(ctxRoot(ctx), session.sessionId).stills, stillFileName(mapped.tSec));
  const size = layoutCanvasSize(session.timeline.layout, probed);
  const compsActive = await renderSessionStill({
    session,
    sessionsRoot: ctxRoot(ctx),
    tSec: mapped.tSec,
    fileSec: mapped.fileSec,
    width: size.width,
    height: size.height,
    dest,
  });
  await mutateSession(ctx, session.sessionId, (current) => {
    recordUsage(current, "render.still", { tSec: mapped.tSec, compsActive });
    return current;
  });
  return {
    path: dest,
    tSec: mapped.tSec,
    fileSec: mapped.fileSec,
    compsActive,
    width: size.width,
    height: size.height,
  };
}

export async function renderWindow(input: unknown, ctx: ToolsContext) {
  const rec = asRecord(input);
  const session = await load(ctx, requireString(rec.sessionId, "sessionId"));
  const probed = await probeMediaMetadata(session.sourcePath);
  const range = clampWindow(
    requireNumber(rec.startSec, "startSec"),
    requireNumber(rec.endSec, "endSec"),
    probed.durationSeconds,
  );
  const start = mapSessionTime(range.startSec, probed.durationSeconds, session.timeline);
  const end = mapSessionTime(range.endSec, probed.durationSeconds, session.timeline);
  const stem = windowFileStem(start.tSec, end.tSec);
  const paths = sessionPaths(ctxRoot(ctx), session.sessionId);
  const dest = path.join(paths.windows, `${stem}.mp4`);
  const posterPath = path.join(paths.windows, `${stem}-poster.png`);
  const size = layoutCanvasSize(session.timeline.layout, probed);
  const rendered = await renderSessionMedia({
    session,
    sessionsRoot: ctxRoot(ctx),
    startSec: range.startSec,
    endSec: range.endSec,
    width: size.width,
    height: size.height,
    dest,
    posterPath,
    hasAudio: probed.hasAudio,
  });
  await mutateSession(ctx, session.sessionId, (current) => {
    recordUsage(current, "render.window", {
      startSec: range.startSec,
      endSec: range.endSec,
      compsActive: rendered.compsActive,
    });
    return current;
  });
  return {
    path: dest,
    posterPath,
    startSec: start.tSec,
    endSec: end.tSec,
    durationSec: rendered.durationSec,
    compsActive: rendered.compsActive,
    width: size.width,
    height: size.height,
    hasAudio: rendered.hasAudio,
  };
}

export async function renderPublish(input: unknown, ctx: ToolsContext) {
  const rec = asRecord(input);
  const session = await load(ctx, requireString(rec.sessionId, "sessionId"));
  const probed = await probeMediaMetadata(session.sourcePath);
  const laid = layoutCanvasSize(session.timeline.layout, probed);
  const size =
    session.timeline.layout.mode === "stack" ? laid : publishSize(laid.width, laid.height);
  const paths = sessionPaths(ctxRoot(ctx), session.sessionId);
  const dest = optionalString(rec.outPath) ? path.resolve(optionalString(rec.outPath)!) : paths.publish;
  const posterPath = dest.replace(/\.mp4$/i, "") + "-poster.png";
  const rendered = await renderSessionMedia({
    session,
    sessionsRoot: ctxRoot(ctx),
    startSec: 0,
    endSec: probed.durationSeconds,
    width: size.width,
    height: size.height,
    dest,
    posterPath,
    hasAudio: probed.hasAudio,
  });
  await mutateSession(ctx, session.sessionId, (current) => {
    recordUsage(current, "render.publish", { path: dest, compsActive: rendered.compsActive });
    return current;
  });
  return {
    path: dest,
    posterPath,
    durationSec: rendered.durationSec,
    width: size.width,
    height: size.height,
    hasAudio: rendered.hasAudio,
  };
}

function assertRangeWithinSource(startSec: number, endSec: number, durationSec: number, tool: string): void {
  if (endSec <= startSec) throw new ToolError("INVALID_INPUT", "endSec must be greater than startSec");
  if (startSec < 0) {
    throw new ToolError("INVALID_INPUT", "startSec must be within the source duration");
  }
  if (endSec > durationSec + 1e-6) {
    throw new ToolError(
      "INVALID_INPUT",
      `${tool} endSec must not exceed source duration (${durationSec}s)`,
    );
  }
}

export async function timelineCut(input: unknown, ctx: ToolsContext) {
  const rec = asRecord(input);
  const sessionId = requireString(rec.sessionId, "sessionId");
  const startSec = requireNumber(rec.startSec, "startSec");
  const endSec = requireNumber(rec.endSec, "endSec");
  if (endSec <= startSec) throw new ToolError("INVALID_INPUT", "endSec must be greater than startSec");
  const current = await load(ctx, sessionId);
  const probed = await probeMediaMetadata(current.sourcePath);
  assertRangeWithinSource(startSec, endSec, probed.durationSeconds, "timeline.cut");
  const session = await mutateSession(ctx, sessionId, (next) => {
    next.timeline.removes = [...next.timeline.removes, { startSec, endSec }];
    recordUsage(next, "timeline.cut", { startSec, endSec });
    return next;
  });
  return snapshot(ctx, session);
}

export async function timelineKeep(input: unknown, ctx: ToolsContext) {
  const rec = asRecord(input);
  const sessionId = requireString(rec.sessionId, "sessionId");
  const startSec = requireNumber(rec.startSec, "startSec");
  const endSec = requireNumber(rec.endSec, "endSec");
  if (endSec <= startSec) throw new ToolError("INVALID_INPUT", "endSec must be greater than startSec");
  const session = await mutateSession(ctx, sessionId, (current) => {
    current.timeline.keeps = [...current.timeline.keeps, { startSec, endSec }];
    recordUsage(current, "timeline.keep", { startSec, endSec });
    return current;
  });
  return snapshot(ctx, session);
}

export async function timelineSpeed(input: unknown, ctx: ToolsContext) {
  const rec = asRecord(input);
  const sessionId = requireString(rec.sessionId, "sessionId");
  const rate = requireNumber(rec.rate, "rate");
  if (rate <= 0) throw new ToolError("INVALID_INPUT", "rate must be > 0");
  const startSec = optionalNumber(rec.startSec);
  const endSec = optionalNumber(rec.endSec);
  const session = await mutateSession(ctx, sessionId, (current) => {
    if (startSec != null && endSec != null) {
      if (endSec <= startSec) throw new ToolError("INVALID_INPUT", "endSec must be greater than startSec");
      current.timeline.speedWindows = [
        ...current.timeline.speedWindows.filter(
          (window) => window.startSec !== startSec || window.endSec !== endSec,
        ),
        { startSec, endSec, rate },
      ];
    } else {
      current.timeline.speed = rate;
    }
    recordUsage(current, "timeline.speed", { rate, startSec, endSec });
    return current;
  });
  return snapshot(ctx, session);
}

export async function timelineLayout(input: unknown, ctx: ToolsContext) {
  const rec = asRecord(input);
  const sessionId = requireString(rec.sessionId, "sessionId");
  const mode = requireString(rec.mode, "mode");
  if (mode !== "split" && mode !== "full" && mode !== "crop" && mode !== "stack") {
    throw new ToolError("INVALID_INPUT", "mode must be split, full, crop, or stack");
  }
  const layout: SessionLayout = { mode };
  if (rec.split && typeof rec.split === "object") {
    const split = rec.split as Record<string, unknown>;
    const talent = optionalNumber(split.talent);
    const graphics = optionalNumber(split.graphics);
    if (talent == null && graphics == null) {
      throw new ToolError("INVALID_INPUT", "split requires talent and/or graphics");
    }
    const left = talent ?? (graphics != null ? 1 - graphics : 0.5);
    const right = graphics ?? 1 - left;
    layout.split = {
      talent: left,
      graphics: right,
      dividerPx: optionalNumber(split.dividerPx),
    };
  }
  if (rec.stack && typeof rec.stack === "object") {
    const stack = rec.stack as Record<string, unknown>;
    const talent = optionalNumber(stack.talent);
    const graphics = optionalNumber(stack.graphics);
    if (talent == null && graphics == null) {
      throw new ToolError("INVALID_INPUT", "stack requires talent and/or graphics");
    }
    const upper = graphics ?? (talent != null ? 1 - talent : 0.5);
    const lower = talent ?? 1 - upper;
    layout.stack = { graphics: upper, talent: lower };
  }
  if (rec.crop && typeof rec.crop === "object") {
    const crop = rec.crop as Record<string, unknown>;
    layout.crop = {
      x: requireNumber(crop.x, "crop.x"),
      y: requireNumber(crop.y, "crop.y"),
      width: requireNumber(crop.width, "crop.width"),
      height: requireNumber(crop.height, "crop.height"),
    };
  }
  if (rec.palette && typeof rec.palette === "object") {
    layout.palette = rec.palette as SessionLayout["palette"];
  }
  const width = optionalNumber(rec.width);
  const height = optionalNumber(rec.height);
  if (width != null) layout.width = width;
  if (height != null) layout.height = height;
  const bandHeight = optionalNumber(rec.bandHeight);
  const captionFontSize = optionalNumber(rec.captionFontSize);
  if (bandHeight != null) {
    if (bandHeight < 8) throw new ToolError("INVALID_INPUT", "bandHeight must be at least 8");
    layout.bandHeight = bandHeight;
  }
  if (captionFontSize != null) {
    if (captionFontSize < 8) throw new ToolError("INVALID_INPUT", "captionFontSize must be at least 8");
    layout.captionFontSize = captionFontSize;
  }
  if (Array.isArray(rec.captions)) {
    layout.captions = rec.captions.map((raw, index) => parseCaption(raw, index));
  }
  const session = await mutateSession(ctx, sessionId, (current) => {
    current.timeline.layout = {
      ...current.timeline.layout,
      ...layout,
      split: layout.split ?? current.timeline.layout.split,
      stack:
        layout.stack ??
        current.timeline.layout.stack ??
        (mode === "stack" ? { graphics: 0.5, talent: 0.5 } : undefined),
      crop: layout.crop ?? current.timeline.layout.crop,
      captions: layout.captions ?? current.timeline.layout.captions,
      bandHeight: layout.bandHeight ?? current.timeline.layout.bandHeight,
      captionFontSize: layout.captionFontSize ?? current.timeline.layout.captionFontSize,
      palette: { ...current.timeline.layout.palette, ...layout.palette },
    };
    current.timeline.layout.mode = mode;
    recordUsage(current, "timeline.layout", { mode });
    return current;
  });
  return snapshot(ctx, session);
}

export async function mediaTranscribe(input: unknown, ctx: ToolsContext) {
  const rec = asRecord(input);
  const session = await load(ctx, requireString(rec.sessionId, "sessionId"));
  const probed = await probeMediaMetadata(session.sourcePath);
  const cacheRoot = sessionPaths(ctxRoot(ctx), session.sessionId).cache;
  const result = ctx.transcribe
    ? await ctx.transcribe(session.sourcePath, probed.durationSeconds)
    : await transcribeSource({
        filePath: session.sourcePath,
        durationSec: probed.durationSeconds,
        cacheRoot,
        skipNetwork: ctx.skipNetwork ?? true,
      });
  await mutateSession(ctx, session.sessionId, (current) => {
    current.transcript = result;
    recordUsage(current, "media.transcribe", { cached: result.cached === true });
    return current;
  });
  return {
    language: result.language,
    durationSec: result.durationSec,
    words: result.words,
    utterances: result.utterances,
    cached: result.cached === true,
  };
}

export const HANDLERS: Record<string, (input: unknown, ctx: ToolsContext) => Promise<unknown>> = {
  "session.create": sessionCreate,
  "session.get": sessionGet,
  "comp.upsert": compUpsert,
  "comp.remove": compRemove,
  "render.still": renderStill,
  "render.window": renderWindow,
  "render.publish": renderPublish,
  "media.transcribe": mediaTranscribe,
  "timeline.cut": timelineCut,
  "timeline.keep": timelineKeep,
  "timeline.speed": timelineSpeed,
  "timeline.layout": timelineLayout,
};

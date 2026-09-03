import { existsSync } from "node:fs";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { defaultFalHttp, falDownload, falPoll, falResult, falSubmit, resolveFalKey } from "../fal/client.js";
import { defaultFalVideoPath, jobPayload, readLooseJob, upsertSessionJob, writeLooseJob } from "../fal/jobs.js";
import { falModelNeedsImage, isFalModelId, listFalModels } from "../fal/models.js";
import { layoutCanvasSize, stackFractions } from "../layout.js";
import { probeMediaMetadata } from "../probe.js";
import { cropFromTalentBox, normalizeBox, parseTalentTarget, type PixelBox } from "../talent/crop.js";
import { sampleTalentBox } from "../talent/pose.js";
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
  assertInsideSession,
  createSessionRecord,
  mutateSession,
  publicSession,
  readSession,
  resolveSessionsRoot,
  sessionPaths,
} from "./store.js";
import type {
  FalJob,
  SessionCaption,
  SessionCaptionWord,
  SessionComp,
  SessionLayout,
  TalentBox,
  ToolSession,
  ToolsContext,
} from "./types.js";

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

function recordUsage(
  session: ToolSession,
  action: string,
  metadata?: Record<string, unknown>,
  costUsd = 0,
): void {
  session.usage = [
    ...session.usage,
    {
      action,
      at: Date.now(),
      costUsd,
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

function falHttpFor(ctx: ToolsContext) {
  return ctx.falHttp ?? defaultFalHttp;
}

function buildFalPayload(input: {
  modelId: string;
  prompt: string;
  image_url?: string;
  end_image_url?: string;
  resolution?: string;
  duration?: number;
  aspect_ratio?: string;
  generate_audio: boolean;
}): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    prompt: input.prompt,
    generate_audio: input.generate_audio,
  };
  if (input.resolution) payload.resolution = input.resolution;
  if (input.duration != null) payload.duration = String(input.duration);
  if (input.aspect_ratio) payload.aspect_ratio = input.aspect_ratio;
  if (input.modelId.endsWith("reference-to-video")) {
    if (input.image_url) payload.image_urls = [input.image_url];
  } else if (input.image_url) {
    payload.image_url = input.image_url;
  }
  if (input.end_image_url) payload.end_image_url = input.end_image_url;
  return payload;
}

async function persistFalJob(
  ctx: ToolsContext,
  sessionId: string | undefined,
  job: FalJob,
): Promise<void> {
  const root = ctxRoot(ctx);
  await writeLooseJob(root, { ...job, sessionId });
  if (!sessionId) return;
  await mutateSession(ctx, sessionId, (current) => {
    current.falJobs = upsertSessionJob(current.falJobs, job);
    return current;
  });
}

async function loadFalJob(
  ctx: ToolsContext,
  sessionId: string | undefined,
  jobId: string,
): Promise<FalJob> {
  if (sessionId) {
    const session = await load(ctx, sessionId);
    const found = (session.falJobs ?? []).find((item) => item.jobId === jobId);
    if (found) return found;
  }
  const loose = await readLooseJob(ctxRoot(ctx), jobId);
  if (loose) return loose;
  throw new ToolError("INVALID_INPUT", `unknown Fal jobId: ${jobId}`);
}

async function materializeFalVideo(input: {
  ctx: ToolsContext;
  job: FalJob;
  sessionId?: string;
  outPath?: string;
}): Promise<FalJob> {
  const key = resolveFalKey(input.ctx.falKey);
  const http = falHttpFor(input.ctx);
  const { videoUrl } = await falResult({
    http,
    key,
    modelId: input.job.modelId,
    jobId: input.job.jobId,
  });
  const dest =
    input.outPath ??
    input.job.path ??
    defaultFalVideoPath({
      sessionFalDir: input.sessionId ? sessionPaths(ctxRoot(input.ctx), input.sessionId).fal : undefined,
      sessionsRoot: ctxRoot(input.ctx),
      jobId: input.job.jobId,
    });
  if (input.sessionId) {
    assertInsideSession(sessionPaths(ctxRoot(input.ctx), input.sessionId).root, dest);
  }
  await mkdir(path.dirname(dest), { recursive: true });
  const bytes = await falDownload({ http, key, url: videoUrl });
  await writeFile(dest, bytes);
  let width = input.job.width;
  let height = input.job.height;
  let durationSec = input.job.durationSec;
  try {
    const probed = await probeMediaMetadata(dest);
    width = probed.width;
    height = probed.height;
    durationSec = probed.durationSeconds;
  } catch {
    /* keep prior */
  }
  return {
    ...input.job,
    status: "completed",
    path: dest,
    width,
    height,
    durationSec,
  };
}

export async function falModels() {
  return { models: listFalModels() };
}

export async function falGenerate(input: unknown, ctx: ToolsContext) {
  const rec = asRecord(input);
  const modelId = requireString(rec.modelId, "modelId");
  if (!isFalModelId(modelId)) {
    throw new ToolError("INVALID_INPUT", `unsupported modelId: ${modelId}`);
  }
  const prompt = requireString(rec.prompt, "prompt");
  const image_url = optionalString(rec.image_url);
  const end_image_url = optionalString(rec.end_image_url);
  if (falModelNeedsImage(modelId) && !image_url) {
    throw new ToolError("INVALID_INPUT", "image_url is required for image-to-video");
  }
  const resolution = optionalString(rec.resolution) ?? "720p";
  if (resolution !== "480p" && resolution !== "720p") {
    throw new ToolError("INVALID_INPUT", "resolution must be 480p or 720p");
  }
  const duration = optionalNumber(rec.duration);
  if (duration != null && (duration < 4 || duration > 30)) {
    throw new ToolError("INVALID_INPUT", "duration must be between 4 and 30");
  }
  const aspect_ratio = optionalString(rec.aspect_ratio);
  const generate_audio = rec.generate_audio === true;
  const sessionId = optionalString(rec.sessionId);
  const outPath = optionalString(rec.outPath);
  if (sessionId) await load(ctx, sessionId);
  const key = resolveFalKey(ctx.falKey);
  const http = falHttpFor(ctx);
  const jobId = await falSubmit({
    http,
    key,
    modelId,
    payload: buildFalPayload({
      modelId,
      prompt,
      image_url,
      end_image_url,
      resolution,
      duration,
      aspect_ratio,
      generate_audio,
    }),
  });
  let job: FalJob = {
    jobId,
    modelId,
    sessionId,
    status: "queued",
    prompt,
    costUsd: 0,
  };
  const peeked = await falPoll({ http, key, modelId, jobId });
  job.status = peeked;
  if (peeked === "completed") {
    job = await materializeFalVideo({ ctx, job, sessionId, outPath });
  }
  await persistFalJob(ctx, sessionId, job);
  if (sessionId) {
    await mutateSession(ctx, sessionId, (current) => {
      recordUsage(
        current,
        "fal.generate",
        { modelId, jobId, resolution, duration, generate_audio },
        job.costUsd ?? 0,
      );
      current.falJobs = upsertSessionJob(current.falJobs, job);
      return current;
    });
  }
  return jobPayload(job);
}

export async function falStatus(input: unknown, ctx: ToolsContext) {
  const rec = asRecord(input);
  const jobId = requireString(rec.jobId, "jobId");
  const sessionId = optionalString(rec.sessionId);
  const job = await loadFalJob(ctx, sessionId, jobId);
  if (job.status === "completed" && job.path && existsSync(job.path)) {
    return jobPayload(job);
  }
  const key = resolveFalKey(ctx.falKey);
  const http = falHttpFor(ctx);
  const status = await falPoll({ http, key, modelId: job.modelId, jobId });
  let next: FalJob = { ...job, status };
  if (status === "completed") {
    next = await materializeFalVideo({ ctx, job: next, sessionId: sessionId ?? job.sessionId });
  }
  await persistFalJob(ctx, sessionId ?? next.sessionId, next);
  return jobPayload(next);
}

function talentPayload(box: TalentBox, sourceWidth: number, sourceHeight: number) {
  return {
    x: box.x,
    y: box.y,
    width: box.width,
    height: box.height,
    normalized: normalizeBox(box, { width: sourceWidth, height: sourceHeight }),
    confidence: box.confidence,
    sampleCount: box.sampleCount,
    sourceWidth,
    sourceHeight,
  };
}

function parseBoxOverride(raw: unknown, sourceWidth: number, sourceHeight: number): PixelBox {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new ToolError("INVALID_INPUT", "box must be { x, y, width, height }");
  }
  const rec = raw as Record<string, unknown>;
  const x = requireNumber(rec.x, "box.x");
  const y = requireNumber(rec.y, "box.y");
  const width = requireNumber(rec.width, "box.width");
  const height = requireNumber(rec.height, "box.height");
  if (width <= 0 || height <= 0) throw new ToolError("INVALID_INPUT", "box width/height must be > 0");
  const frac = x <= 1 && y <= 1 && width <= 1 && height <= 1;
  if (frac) {
    return { x: x * sourceWidth, y: y * sourceHeight, width: width * sourceWidth, height: height * sourceHeight };
  }
  return { x, y, width, height };
}

async function resolveTalentBox(
  ctx: ToolsContext,
  session: ToolSession,
  rec: Record<string, unknown>,
  source: { width: number; height: number; durationSeconds: number },
): Promise<TalentBox> {
  if (rec.box != null) {
    const box = parseBoxOverride(rec.box, source.width, source.height);
    return { ...box, confidence: 1, sampleCount: 0 };
  }
  const detect = ctx.detectTalent ?? sampleTalentBox;
  const box = await detect({
    sourcePath: session.sourcePath,
    cacheDir: sessionPaths(ctxRoot(ctx), session.sessionId).talent,
    durationSec: source.durationSeconds,
    sourceWidth: source.width,
    sourceHeight: source.height,
    tSec: optionalNumber(rec.tSec),
    sampleEverySec: optionalNumber(rec.sampleEverySec),
    maxSamples: optionalNumber(rec.maxSamples),
  });
  return box;
}

export async function mediaFace(input: unknown, ctx: ToolsContext) {
  const rec = asRecord(input);
  const sessionId = requireString(rec.sessionId, "sessionId");
  const session = await load(ctx, sessionId);
  const probed = await probeMediaMetadata(session.sourcePath);
  const box = await resolveTalentBox(ctx, session, rec, probed);
  await mutateSession(ctx, sessionId, (current) => {
    current.talentBox = box;
    recordUsage(current, "media.face", { sampleCount: box.sampleCount, confidence: box.confidence });
    return current;
  });
  return talentPayload(box, probed.width, probed.height);
}

export async function timelineCropFromTalent(input: unknown, ctx: ToolsContext) {
  const rec = asRecord(input);
  const sessionId = requireString(rec.sessionId, "sessionId");
  const session = await load(ctx, sessionId);
  const probed = await probeMediaMetadata(session.sourcePath);
  let target;
  try {
    target = parseTalentTarget(rec.target);
  } catch (error) {
    throw new ToolError("INVALID_INPUT", error instanceof Error ? error.message : "invalid target");
  }
  const zoom = optionalNumber(rec.zoom) ?? 1;
  if (zoom <= 0) throw new ToolError("INVALID_INPUT", "zoom must be > 0");
  const box =
    rec.box != null || !session.talentBox
      ? await resolveTalentBox(ctx, session, rec, probed)
      : session.talentBox;
  const layout = session.timeline.layout;
  const canvas = layoutCanvasSize(
    { ...layout, mode: "stack", stack: layout.stack ?? { graphics: 0.5, talent: 0.5 } },
    probed,
  );
  const talentFrac = stackFractions(layout.stack ? layout : { mode: "stack", stack: { graphics: 0.5, talent: 0.5 } })
    .talent;
  const pane = { width: canvas.width, height: canvas.height * talentFrac };
  const framed = cropFromTalentBox({
    box,
    source: { width: probed.width, height: probed.height },
    pane,
    anchor: target,
    zoom,
  });
  const next = await mutateSession(ctx, sessionId, (current) => {
    current.talentBox = box;
    const prev = current.timeline.layout;
    current.timeline.layout = {
      ...prev,
      mode: "stack",
      stack: prev.stack ?? { graphics: 0.5, talent: 0.5 },
      crop: framed.crop,
    };
    recordUsage(current, "timeline.cropFromTalent", {
      zoom,
      anchorX: target.anchorX,
      anchorY: target.anchorY,
    });
    return current;
  });
  return snapshot(ctx, next);
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
  "fal.models": falModels,
  "fal.generate": falGenerate,
  "fal.status": falStatus,
  "media.face": mediaFace,
  "timeline.cropFromTalent": timelineCropFromTalent,
};

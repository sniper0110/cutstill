import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { probeMediaMetadata } from "../probe.js";
import { renderSessionStill, stillFileName } from "../remotion/engine.js";
import { assertCompId, assertSandboxSource } from "../sandbox.js";
import { mapSourceTime } from "../time.js";
import { transcribeSource } from "../transcribe/index.js";
import {
  asRecord,
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
import type { SessionComp, ToolSession, ToolsContext } from "./types.js";

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

export async function renderStill(input: unknown, ctx: ToolsContext) {
  const rec = asRecord(input);
  const session = await load(ctx, requireString(rec.sessionId, "sessionId"));
  const tSec = requireNumber(rec.tSec, "tSec");
  const mapped = mapSourceTime(tSec);
  const probed = await probeMediaMetadata(session.sourcePath);
  const dest = path.join(sessionPaths(ctxRoot(ctx), session.sessionId).stills, stillFileName(mapped.tSec));
  const compsActive = await renderSessionStill({
    session,
    sessionsRoot: ctxRoot(ctx),
    tSec: mapped.tSec,
    fileSec: mapped.fileSec,
    width: probed.width,
    height: probed.height,
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
    width: probed.width,
    height: probed.height,
  };
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
  "render.still": renderStill,
  "media.transcribe": mediaTranscribe,
};

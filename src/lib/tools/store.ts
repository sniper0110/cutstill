import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { uuid } from "../uuid.js";
import { ToolError } from "./errors.js";
import type { ToolSession, ToolsContext } from "./types.js";

export function resolveSessionsRoot(ctx?: Pick<ToolsContext, "sessionsRoot">): string {
  if (ctx?.sessionsRoot) return path.resolve(ctx.sessionsRoot);
  if (process.env.CUTSTILL_SESSIONS_ROOT) return path.resolve(process.env.CUTSTILL_SESSIONS_ROOT);
  return path.resolve(process.cwd(), "sessions");
}

export function sessionDir(sessionsRoot: string, sessionId: string): string {
  return path.join(sessionsRoot, sessionId);
}

export function sessionPaths(sessionsRoot: string, sessionId: string) {
  const root = sessionDir(sessionsRoot, sessionId);
  return {
    root,
    session: path.join(root, "session.json"),
    brief: path.join(root, "brief.md"),
    transcript: path.join(root, "transcript.json"),
    comps: path.join(root, "comps"),
    stills: path.join(root, "stills"),
    windows: path.join(root, "windows"),
    publish: path.join(root, "publish.mp4"),
    remotion: path.join(root, "remotion"),
    remotionPublic: path.join(root, "remotion", "public"),
    usage: path.join(root, "usage.json"),
    cache: path.join(root, "cache"),
  };
}

export async function writeSession(sessionsRoot: string, session: ToolSession): Promise<void> {
  const paths = sessionPaths(sessionsRoot, session.sessionId);
  await mkdir(paths.root, { recursive: true });
  await mkdir(paths.comps, { recursive: true });
  await mkdir(paths.stills, { recursive: true });
  await mkdir(paths.windows, { recursive: true });
  await mkdir(paths.remotionPublic, { recursive: true });
  await mkdir(paths.cache, { recursive: true });
  await writeFile(paths.session, JSON.stringify(session, null, 2), "utf8");
  await writeFile(paths.usage, JSON.stringify(session.usage, null, 2), "utf8");
  if (session.transcript) {
    await writeFile(paths.transcript, JSON.stringify(session.transcript, null, 2), "utf8");
  }
  if (session.briefCopy != null) {
    await writeFile(paths.brief, session.briefCopy, "utf8");
  }
}

export async function readSession(sessionsRoot: string, sessionId: string): Promise<ToolSession> {
  const file = sessionPaths(sessionsRoot, sessionId).session;
  if (!existsSync(file)) {
    throw new ToolError("SESSION_NOT_FOUND", `session not found: ${sessionId}`);
  }
  const raw = JSON.parse(await readFile(file, "utf8")) as ToolSession;
  if (!Array.isArray(raw.comps)) raw.comps = [];
  if (!Array.isArray(raw.usage)) raw.usage = [];
  return raw;
}

export async function mutateSession(
  ctx: ToolsContext,
  sessionId: string,
  fn: (session: ToolSession) => ToolSession | Promise<ToolSession>,
): Promise<ToolSession> {
  const root = resolveSessionsRoot(ctx);
  const current = await readSession(root, sessionId);
  const next = await fn(current);
  next.updatedAt = (ctx.now ?? Date.now)();
  await writeSession(root, next);
  return next;
}

export async function createSessionRecord(
  ctx: ToolsContext,
  input: { sourcePath: string; briefPath?: string; briefCopy?: string },
): Promise<ToolSession> {
  const now = (ctx.now ?? Date.now)();
  const session: ToolSession = {
    sessionId: uuid(),
    sourcePath: path.resolve(input.sourcePath),
    briefPath: input.briefPath ? path.resolve(input.briefPath) : undefined,
    briefCopy: input.briefCopy,
    comps: [],
    usage: [],
    createdAt: now,
    updatedAt: now,
  };
  await writeSession(resolveSessionsRoot(ctx), session);
  return session;
}

export function publicSession(session: ToolSession, sessionsRoot: string) {
  return {
    ...session,
    paths: sessionPaths(sessionsRoot, session.sessionId),
  };
}

export function assertInsideSession(sessionRoot: string, targetPath: string): string {
  const root = path.resolve(sessionRoot);
  const resolved = path.resolve(targetPath);
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) {
    throw new ToolError("SANDBOX_VIOLATION", `path escapes session: ${targetPath}`);
  }
  return resolved;
}

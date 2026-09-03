import { existsSync } from "node:fs";
import { copyFile, mkdir, rename } from "node:fs/promises";
import path from "node:path";
import { runFfmpeg } from "../ffmpeg.js";
import { ToolError } from "../tools/errors.js";
import { sessionPaths } from "../tools/store.js";
import type { SessionComp, ToolSession } from "../tools/types.js";
import { writeRemotionHost, writeRemotionVideoHost } from "./host.js";

export const WINDOW_MAX_SEC = 12;
export const PUBLISH_MAX_WIDTH = 1920;
export const PUBLISH_MAX_HEIGHT = 1080;

process.env.REMOTION_CHROME_DISABLE_SANDBOX ??= "1";

function chromePath(): string | undefined {
  const fromEnv = process.env.PUPPETEER_EXECUTABLE_PATH || process.env.CHROME_PATH;
  if (fromEnv && existsSync(fromEnv)) return fromEnv;
  for (const candidate of [
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/local/bin/google-chrome",
    "/usr/local/bin/chrome",
  ]) {
    if (existsSync(candidate)) return candidate;
  }
  return undefined;
}

function webpackOverride(current: { resolve?: { alias?: unknown } }): typeof current {
  const prev =
    current.resolve?.alias && typeof current.resolve.alias === "object" && !Array.isArray(current.resolve.alias)
      ? current.resolve.alias
      : {};
  return {
    ...current,
    resolve: {
      ...current.resolve,
      alias: {
        ...prev,
        http: false,
        https: false,
        fs: false,
        "node:http": false,
        "node:https": false,
        "node:fs": false,
        child_process: false,
        "node:child_process": false,
        net: false,
        "node:net": false,
      },
    },
  };
}

export async function extractSourceFrame(input: {
  sourcePath: string;
  fileSec: number;
  dest: string;
}): Promise<void> {
  await mkdir(path.dirname(input.dest), { recursive: true });
  await runFfmpeg([
    "-y",
    "-ss",
    String(Math.max(0, input.fileSec)),
    "-i",
    input.sourcePath,
    "-frames:v",
    "1",
    "-update",
    "1",
    input.dest,
  ]);
}

export function compsCovering(comps: SessionComp[], tSec: number): SessionComp[] {
  return comps.filter((comp) => tSec >= comp.window.startSec && tSec < comp.window.endSec);
}

export function compsOverlapping(comps: SessionComp[], startSec: number, endSec: number): SessionComp[] {
  return comps.filter((comp) => comp.window.startSec < endSec && comp.window.endSec > startSec);
}

export function clampWindow(startSec: number, endSec: number, sourceDuration: number): {
  startSec: number;
  endSec: number;
} {
  const start = Math.max(0, startSec);
  let end = Math.min(sourceDuration, endSec);
  if (!(end > start)) {
    throw new ToolError("INVALID_INPUT", "endSec must be greater than startSec");
  }
  if (end - start > WINDOW_MAX_SEC) {
    end = start + WINDOW_MAX_SEC;
  }
  return { startSec: start, endSec: end };
}

export function publishSize(width: number, height: number): { width: number; height: number } {
  if (width <= PUBLISH_MAX_WIDTH && height <= PUBLISH_MAX_HEIGHT) {
    return { width, height };
  }
  const scale = Math.min(PUBLISH_MAX_WIDTH / width, PUBLISH_MAX_HEIGHT / height);
  return {
    width: Math.max(2, Math.round((width * scale) / 2) * 2),
    height: Math.max(2, Math.round((height * scale) / 2) * 2),
  };
}

export function windowFileStem(startSec: number, endSec: number): string {
  const fmt = (n: number) => n.toFixed(3).replace(".", "p");
  return `window-${fmt(startSec)}-${fmt(endSec)}`;
}

export async function renderSessionStill(input: {
  session: ToolSession;
  sessionsRoot: string;
  tSec: number;
  fileSec: number;
  width: number;
  height: number;
  dest: string;
}): Promise<string[]> {
  const paths = sessionPaths(input.sessionsRoot, input.session.sessionId);
  const framePath = path.join(paths.remotionPublic, "frame.png");
  await extractSourceFrame({
    sourcePath: input.session.sourcePath,
    fileSec: input.fileSec,
    dest: framePath,
  });

  const active = compsCovering(input.session.comps, input.tSec);
  await writeRemotionHost(paths.remotion, {
    active,
    width: input.width,
    height: input.height,
    fps: 30,
  });

  const { bundle } = await import("@remotion/bundler");
  const { renderStill, selectComposition } = await import("@remotion/renderer");

  const serveUrl = await bundle({
    entryPoint: path.join(paths.remotion, "index.ts"),
    publicDir: paths.remotionPublic,
    rootDir: process.cwd(),
    webpackOverride,
    onProgress: () => undefined,
  });

  const inputProps = {
    palette: {},
    compProps: Object.fromEntries(active.map((comp) => [comp.id, comp.props])),
  };

  const browserExecutable = chromePath();
  const composition = await selectComposition({
    serveUrl,
    id: "StillHost",
    inputProps,
    logLevel: "error",
    timeoutInMilliseconds: 60_000,
    ...(browserExecutable ? { browserExecutable } : {}),
  });

  await mkdir(path.dirname(input.dest), { recursive: true });
  await renderStill({
    serveUrl,
    composition,
    output: input.dest,
    inputProps,
    frame: 0,
    logLevel: "error",
    timeoutInMilliseconds: 60_000,
    chromiumOptions: {},
    ...(browserExecutable ? { browserExecutable } : {}),
  });

  return active.map((comp) => comp.id);
}

async function stageSourceClip(input: {
  sourcePath: string;
  dest: string;
  startSec: number;
  durationSec: number;
}): Promise<void> {
  await mkdir(path.dirname(input.dest), { recursive: true });
  await runFfmpeg([
    "-y",
    "-ss",
    String(Math.max(0, input.startSec)),
    "-t",
    String(Math.max(0.05, input.durationSec)),
    "-i",
    input.sourcePath,
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    "-shortest",
    input.dest,
  ]);
}

async function muxAudioOntoVideo(input: {
  videoPath: string;
  audioPath: string;
  dest: string;
  hasAudio: boolean;
}): Promise<boolean> {
  if (!input.hasAudio) {
    if (path.resolve(input.videoPath) !== path.resolve(input.dest)) {
      await copyFile(input.videoPath, input.dest);
    }
    return false;
  }
  const tmp = `${input.dest}.mux.mp4`;
  await runFfmpeg([
    "-y",
    "-i",
    input.videoPath,
    "-i",
    input.audioPath,
    "-map",
    "0:v:0",
    "-map",
    "1:a:0",
    "-c:v",
    "copy",
    "-c:a",
    "aac",
    "-shortest",
    tmp,
  ]);
  await rename(tmp, input.dest);
  return true;
}

export async function renderSessionMedia(input: {
  session: ToolSession;
  sessionsRoot: string;
  startSec: number;
  endSec: number;
  width: number;
  height: number;
  dest: string;
  posterPath: string;
  hasAudio: boolean;
}): Promise<{ compsActive: string[]; hasAudio: boolean; durationSec: number }> {
  const durationSec = Math.max(0.05, input.endSec - input.startSec);
  const fps = 30;
  const durationInFrames = Math.max(1, Math.round(durationSec * fps));
  const paths = sessionPaths(input.sessionsRoot, input.session.sessionId);
  const publicSource = path.join(paths.remotionPublic, "source.mp4");
  await stageSourceClip({
    sourcePath: input.session.sourcePath,
    dest: publicSource,
    startSec: input.startSec,
    durationSec,
  });

  const active = compsOverlapping(input.session.comps, input.startSec, input.endSec);
  await writeRemotionVideoHost(paths.remotion, {
    active,
    width: input.width,
    height: input.height,
    fps,
    durationInFrames,
    sourceStartSec: input.startSec,
  });

  const { bundle } = await import("@remotion/bundler");
  const { renderMedia, selectComposition } = await import("@remotion/renderer");

  const serveUrl = await bundle({
    entryPoint: path.join(paths.remotion, "index.ts"),
    publicDir: paths.remotionPublic,
    rootDir: process.cwd(),
    webpackOverride,
    onProgress: () => undefined,
  });

  const inputProps = {
    palette: {},
    compProps: Object.fromEntries(active.map((comp) => [comp.id, comp.props])),
  };

  const browserExecutable = chromePath();
  const composition = await selectComposition({
    serveUrl,
    id: "VideoHost",
    inputProps,
    logLevel: "error",
    timeoutInMilliseconds: 120_000,
    ...(browserExecutable ? { browserExecutable } : {}),
  });

  await mkdir(path.dirname(input.dest), { recursive: true });
  const remotionOut = `${input.dest}.remotion.mp4`;
  await renderMedia({
    serveUrl,
    composition: {
      ...composition,
      durationInFrames: Math.max(composition.durationInFrames, durationInFrames),
      width: input.width,
      height: input.height,
    },
    codec: "h264",
    outputLocation: remotionOut,
    inputProps,
    logLevel: "error",
    timeoutInMilliseconds: 180_000,
    chromiumOptions: {},
    muted: true,
    ...(browserExecutable ? { browserExecutable } : {}),
  });

  const hasAudio = await muxAudioOntoVideo({
    videoPath: remotionOut,
    audioPath: publicSource,
    dest: input.dest,
    hasAudio: input.hasAudio,
  });

  const posterSec = durationSec / 2;
  await extractSourceFrame({ sourcePath: input.dest, fileSec: posterSec, dest: input.posterPath });
  return { compsActive: active.map((comp) => comp.id), hasAudio, durationSec };
}

export async function copyFrameIfNeeded(src: string, dest: string): Promise<void> {
  if (src === dest) return;
  await mkdir(path.dirname(dest), { recursive: true });
  await copyFile(src, dest);
}

export function stillFileName(tSec: number): string {
  return `still-t${tSec.toFixed(3).replace(".", "p")}.png`;
}

export function assertStillWrote(dest: string): void {
  if (!dest.endsWith(".png")) {
    throw new ToolError("TOOL_FAILED", "still output must be a PNG");
  }
}

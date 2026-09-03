import { existsSync } from "node:fs";
import { copyFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { runFfmpeg } from "../ffmpeg.js";
import { ToolError } from "../tools/errors.js";
import { sessionPaths } from "../tools/store.js";
import type { SessionComp, ToolSession } from "../tools/types.js";
import { writeRemotionHost } from "./host.js";

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

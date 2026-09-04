import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { getFfmpegPath } from "./ffmpeg.js";
import { ToolError } from "./tools/errors.js";

const execFileAsync = promisify(execFile);

export interface MediaStreamInfo {
  index: number;
  codecType: string;
  codecName: string;
}

export interface MediaMetadataProbe {
  durationSeconds: number;
  width: number;
  height: number;
  hasAudio: boolean;
  streams: MediaStreamInfo[];
}

export function isFullNullDecode(args: readonly string[]): boolean {
  const index = args.indexOf("-f");
  return index >= 0 && args[index + 1] === "null";
}

function findFfprobePath(): string {
  const fromEnv = process.env.FFPROBE_PATH?.trim();
  if (fromEnv && existsSync(fromEnv)) return fromEnv;
  try {
    const sibling = path.join(path.dirname(getFfmpegPath()), "ffprobe");
    if (existsSync(sibling)) return sibling;
  } catch {
    /* ignore */
  }
  for (const candidate of ["/usr/bin/ffprobe", "/usr/local/bin/ffprobe"]) {
    if (existsSync(candidate)) return candidate;
  }
  return "ffprobe";
}

interface FfprobeJson {
  format?: { duration?: string };
  streams?: Array<{
    index?: number;
    codec_type?: string;
    codec_name?: string;
    width?: number;
    height?: number;
  }>;
}

function parseFfprobeJson(stdout: string): MediaMetadataProbe | null {
  const text = stdout.trim();
  if (!text.startsWith("{")) return null;
  let parsed: FfprobeJson;
  try {
    parsed = JSON.parse(text) as FfprobeJson;
  } catch {
    return null;
  }
  const durationSeconds = Number(parsed.format?.duration);
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) return null;
  const video = (parsed.streams ?? []).find((stream) => stream.codec_type === "video");
  const streams = (parsed.streams ?? []).map((stream, index) => ({
    index: Number.isFinite(stream.index) ? Number(stream.index) : index,
    codecType: String(stream.codec_type ?? "unknown"),
    codecName: String(stream.codec_name ?? "unknown"),
  }));
  return {
    durationSeconds,
    width: video?.width && video.width > 0 ? video.width : 640,
    height: video?.height && video.height > 0 ? video.height : 360,
    hasAudio: streams.some((stream) => stream.codecType === "audio"),
    streams,
  };
}

async function probeWithFfprobe(filePath: string): Promise<MediaMetadataProbe | null> {
  const bin = findFfprobePath();
  const args = ["-v", "error", "-show_format", "-show_streams", "-print_format", "json", filePath];
  if (isFullNullDecode(args)) {
    throw new ToolError("TOOL_FAILED", "refusing full-file -f null decode for metadata probe");
  }
  try {
    const { stdout } = await execFileAsync(bin, args, { maxBuffer: 5 * 1024 * 1024 });
    return parseFfprobeJson(stdout.toString());
  } catch {
    return null;
  }
}

function parseBanner(banner: string): MediaMetadataProbe | null {
  const durationMatch = banner.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
  const sizeMatch = banner.match(/(\d{2,5})x(\d{2,5})/);
  if (!durationMatch || !sizeMatch) return null;
  const durationSeconds =
    Number(durationMatch[1]) * 3600 + Number(durationMatch[2]) * 60 + Number(durationMatch[3]);
  const streams: MediaStreamInfo[] = [];
  const pattern = /Stream #0:(\d+).*?:\s+(Video|Audio|Subtitle|Data):\s+([A-Za-z0-9_]+)/g;
  for (const match of banner.matchAll(pattern)) {
    streams.push({
      index: Number(match[1]),
      codecType: match[2]!.toLowerCase(),
      codecName: match[3]!,
    });
  }
  return {
    durationSeconds,
    width: Number(sizeMatch[1]),
    height: Number(sizeMatch[2]),
    hasAudio: streams.some((stream) => stream.codecType === "audio") || /Audio:/.test(banner),
    streams,
  };
}

async function probeWithFfmpegBanner(filePath: string): Promise<MediaMetadataProbe> {
  const args = ["-hide_banner", "-i", filePath];
  if (isFullNullDecode(args)) {
    throw new ToolError("TOOL_FAILED", "refusing full-file -f null decode for metadata probe");
  }
  try {
    await execFileAsync(getFfmpegPath(), args, { maxBuffer: 5 * 1024 * 1024 });
  } catch (error) {
    const stderr =
      error && typeof error === "object" && "stderr" in error
        ? String((error as { stderr: unknown }).stderr)
        : "";
    const stdout =
      error && typeof error === "object" && "stdout" in error
        ? String((error as { stdout: unknown }).stdout)
        : "";
    const parsed = parseBanner(`${stderr}\n${stdout}`);
    if (parsed) return parsed;
  }
  throw new ToolError("TOOL_FAILED", `could not probe: ${filePath}`);
}

/** Metadata-only duration/size/streams. Never `ffmpeg -f null`. */
export async function probeMediaMetadata(filePath: string): Promise<MediaMetadataProbe> {
  if (!existsSync(filePath)) {
    throw new ToolError("MEDIA_NOT_FOUND", `media not found: ${filePath}`);
  }
  const fromFfprobe = await probeWithFfprobe(filePath);
  if (fromFfprobe) return fromFfprobe;
  return probeWithFfmpegBanner(filePath);
}

import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { promisify } from "node:util";
import ffmpegStatic from "ffmpeg-static";

const execFileAsync = promisify(execFile);

export function getFfmpegPath(): string {
  if (process.env.FFMPEG_PATH && existsSync(process.env.FFMPEG_PATH)) {
    return process.env.FFMPEG_PATH;
  }
  if (ffmpegStatic && existsSync(ffmpegStatic)) return ffmpegStatic;
  for (const candidate of ["/usr/bin/ffmpeg", "/usr/local/bin/ffmpeg"]) {
    if (existsSync(candidate)) return candidate;
  }
  if (ffmpegStatic) return ffmpegStatic;
  throw new Error("ffmpeg binary not found");
}

export async function runFfmpeg(args: string[]): Promise<{ stdout: string; stderr: string }> {
  try {
    const result = await execFileAsync(getFfmpegPath(), args, {
      maxBuffer: 32 * 1024 * 1024,
    });
    return {
      stdout: result.stdout?.toString() ?? "",
      stderr: result.stderr?.toString() ?? "",
    };
  } catch (error) {
    const stderr =
      error && typeof error === "object" && "stderr" in error
        ? String((error as { stderr: unknown }).stderr)
        : "";
    const stdout =
      error && typeof error === "object" && "stdout" in error
        ? String((error as { stdout: unknown }).stdout)
        : "";
    const message = stderr.trim() || stdout.trim() || (error instanceof Error ? error.message : "ffmpeg failed");
    throw new Error(message.slice(0, 800));
  }
}

export async function runFfmpegBuffer(args: string[]): Promise<Buffer> {
  try {
    const result = await execFileAsync(getFfmpegPath(), args, {
      maxBuffer: 64 * 1024 * 1024,
      encoding: "buffer",
    });
    return Buffer.isBuffer(result.stdout) ? result.stdout : Buffer.from(result.stdout);
  } catch (error) {
    const stderr =
      error && typeof error === "object" && "stderr" in error
        ? String((error as { stderr: unknown }).stderr)
        : "";
    throw new Error((stderr.trim() || (error instanceof Error ? error.message : "ffmpeg failed")).slice(0, 800));
  }
}

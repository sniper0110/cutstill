import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runFfmpeg } from "../src/lib/ffmpeg.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const FIXTURE_DIR = path.join(ROOT, "test", "fixtures");
export const STANDIN_MP4 = path.join(FIXTURE_DIR, "standin.mp4");
export const FACE_FIXTURE_MP4 = path.join(FIXTURE_DIR, "face-right.mp4");

/** Known face+chest blob, right of center, for talent-crop tests. */
export const FACE_FIXTURE = {
  width: 1280,
  height: 720,
  box: { x: 700, y: 100, width: 180, height: 240 },
  color: "0xff3399",
};

/** Short local stand-in. testsrc2 so a still is not a solid plate. */
export async function generateStandInMp4(dest = STANDIN_MP4, seconds = 3): Promise<string> {
  await mkdir(path.dirname(dest), { recursive: true });
  await runFfmpeg([
    "-y",
    "-f",
    "lavfi",
    "-i",
    `testsrc2=size=640x360:rate=30:duration=${seconds}`,
    "-f",
    "lavfi",
    "-i",
    `sine=frequency=440:sample_rate=48000:duration=${seconds}`,
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    "-shortest",
    dest,
  ]);
  return dest;
}

export async function generateFaceFixtureMp4(dest = FACE_FIXTURE_MP4, seconds = 2): Promise<string> {
  await mkdir(path.dirname(dest), { recursive: true });
  const { width, height, box, color } = FACE_FIXTURE;
  await runFfmpeg([
    "-y",
    "-f",
    "lavfi",
    "-i",
    `color=c=0x102030:s=${width}x${height}:rate=30:duration=${seconds}`,
    "-f",
    "lavfi",
    "-i",
    `color=c=${color}:s=${box.width}x${box.height}:rate=30:duration=${seconds}`,
    "-filter_complex",
    `[0:v][1:v]overlay=${box.x}:${box.y}:shortest=1`,
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    dest,
  ]);
  return dest;
}

export async function ensureStandInMp4(): Promise<string> {
  if (!existsSync(STANDIN_MP4)) {
    await generateStandInMp4();
  }
  return STANDIN_MP4;
}

export async function ensureFaceFixtureMp4(): Promise<string> {
  return generateFaceFixtureMp4();
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  await generateStandInMp4();
  await generateFaceFixtureMp4();
  process.stdout.write(`${STANDIN_MP4}\n${FACE_FIXTURE_MP4}\n`);
}

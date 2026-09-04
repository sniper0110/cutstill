import { runFfmpegBuffer } from "./ffmpeg.js";

export const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export function isPngMagic(bytes: Buffer): boolean {
  return bytes.length >= 8 && bytes.subarray(0, 8).equals(PNG_MAGIC);
}

export async function readRgb24(pngPath: string): Promise<Buffer> {
  return runFfmpegBuffer(["-v", "error", "-i", pngPath, "-f", "rawvideo", "-pix_fmt", "rgb24", "pipe:1"]);
}

export function samplePixel(rgb: Buffer, width: number, x: number, y: number): { r: number; g: number; b: number } {
  const offset = (y * width + x) * 3;
  return { r: rgb[offset] ?? 0, g: rgb[offset + 1] ?? 0, b: rgb[offset + 2] ?? 0 };
}

export function analyzeRgb(rgb: Buffer): { uniqueColors: number; range: number } {
  let min = 255;
  let max = 0;
  const colors = new Set<number>();
  for (let i = 0; i < rgb.length; i += 3) {
    const r = rgb[i] ?? 0;
    const g = rgb[i + 1] ?? 0;
    const b = rgb[i + 2] ?? 0;
    min = Math.min(min, r, g, b);
    max = Math.max(max, r, g, b);
    colors.add((r << 16) | (g << 8) | b);
  }
  return { uniqueColors: colors.size, range: max - min };
}

/** A near-solid plate has almost no authored pixels. */
export function isNearSolidPlate(rgb: Buffer): boolean {
  const { uniqueColors, range } = analyzeRgb(rgb);
  return uniqueColors < 8 && range < 12;
}

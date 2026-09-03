import type { CropLayout } from "../tools/types.js";

export interface PixelBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface TalentBox extends PixelBox {
  confidence: number;
  sampleCount: number;
}

export interface SourceSize {
  width: number;
  height: number;
}

export interface PaneSize {
  width: number;
  height: number;
}

export interface TalentAnchor {
  anchorX: number;
  anchorY: number;
}

export const POSE_NOSE = 0;
export const POSE_LEFT_EYE = 2;
export const POSE_RIGHT_EYE = 5;
export const POSE_LEFT_EAR = 7;
export const POSE_RIGHT_EAR = 8;
export const POSE_LEFT_SHOULDER = 11;
export const POSE_RIGHT_SHOULDER = 12;
export const POSE_LEFT_HIP = 23;
export const POSE_RIGHT_HIP = 24;

const VISIBLE = 0.35;

export function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

export function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) return (sorted[mid - 1]! + sorted[mid]!) / 2;
  return sorted[mid]!;
}

export function normalizeBox(box: PixelBox, source: SourceSize): PixelBox {
  return {
    x: box.x / source.width,
    y: box.y / source.height,
    width: box.width / source.width,
    height: box.height / source.height,
  };
}

export function boxCenter(box: PixelBox): { x: number; y: number } {
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/** Cover window in source pixels — same zoom object-fit:cover uses on the pane. */
export function coverWindow(source: SourceSize, pane: PaneSize): PixelBox {
  const scale = Math.max(pane.width / source.width, pane.height / source.height);
  const width = pane.width / scale;
  const height = pane.height / scale;
  return {
    x: (source.width - width) / 2,
    y: (source.height - height) / 2,
    width,
    height,
  };
}

export function parseTalentTarget(target: unknown): TalentAnchor {
  if (target == null || target === "center") return { anchorX: 0.5, anchorY: 0.5 };
  if (typeof target === "object" && !Array.isArray(target)) {
    const rec = target as Record<string, unknown>;
    const anchorX = typeof rec.anchorX === "number" ? rec.anchorX : 0.5;
    const anchorY = typeof rec.anchorY === "number" ? rec.anchorY : 0.5;
    if (anchorX < 0 || anchorX > 1 || anchorY < 0 || anchorY > 1) {
      throw new Error("anchorX/anchorY must be between 0 and 1");
    }
    return { anchorX, anchorY };
  }
  throw new Error("target must be \"center\" or { anchorX, anchorY }");
}

/**
 * Slide the cover-sized window so the talent point sits at the pane anchor.
 * zoom=1 keeps current cover feel; zoom>1 tightens (smaller source window).
 */
export function cropFromTalentBox(input: {
  box: PixelBox;
  source: SourceSize;
  pane: PaneSize;
  anchor: TalentAnchor;
  zoom?: number;
}): { crop: CropLayout; window: PixelBox; faceCenter: { x: number; y: number } } {
  const zoom = input.zoom == null || input.zoom <= 0 ? 1 : input.zoom;
  const cover = coverWindow(input.source, input.pane);
  const width = clamp(cover.width / zoom, 2, input.source.width);
  const height = clamp(cover.height / zoom, 2, input.source.height);
  const face = boxCenter(input.box);
  let x = face.x - input.anchor.anchorX * width;
  let y = face.y - input.anchor.anchorY * height;
  x = clamp(x, 0, Math.max(0, input.source.width - width));
  y = clamp(y, 0, Math.max(0, input.source.height - height));
  const window: PixelBox = { x, y, width, height };
  return {
    crop: normalizeBox(window, input.source),
    window,
    faceCenter: face,
  };
}

export interface PoseLandmark {
  x: number;
  y: number;
  visibility?: number;
}

function visible(landmarks: PoseLandmark[], index: number): PoseLandmark | null {
  const point = landmarks[index];
  if (!point) return null;
  if (point.visibility != null && point.visibility < VISIBLE) return null;
  return point;
}

/** Face + chest box from Pose Landmarker (normalized landmarks). */
export function boxFromLandmarks(
  landmarks: PoseLandmark[],
  source: SourceSize,
): { box: PixelBox; confidence: number } | null {
  const nose = visible(landmarks, POSE_NOSE);
  const leftEye = visible(landmarks, POSE_LEFT_EYE);
  const rightEye = visible(landmarks, POSE_RIGHT_EYE);
  const leftEar = visible(landmarks, POSE_LEFT_EAR);
  const rightEar = visible(landmarks, POSE_RIGHT_EAR);
  const leftShoulder = visible(landmarks, POSE_LEFT_SHOULDER);
  const rightShoulder = visible(landmarks, POSE_RIGHT_SHOULDER);
  const leftHip = visible(landmarks, POSE_LEFT_HIP);
  const rightHip = visible(landmarks, POSE_RIGHT_HIP);

  const facePts = [nose, leftEye, rightEye, leftEar, rightEar].filter(
    (item): item is PoseLandmark => item != null,
  );
  const shoulders = [leftShoulder, rightShoulder].filter((item): item is PoseLandmark => item != null);
  if (facePts.length === 0 && shoulders.length === 0) return null;

  const xs = [...facePts, ...shoulders].map((item) => item.x);
  const ys = [...facePts, ...shoulders].map((item) => item.y);
  const vis = [...facePts, ...shoulders]
    .map((item) => item.visibility)
    .filter((item): item is number => typeof item === "number");

  let top = Math.min(...ys);
  let bottom = Math.max(...ys);
  let left = Math.min(...xs);
  let right = Math.max(...xs);

  if (shoulders.length === 2) {
    const shoulderSpan = Math.abs(shoulders[0]!.x - shoulders[1]!.x);
    left = Math.min(left, Math.min(shoulders[0]!.x, shoulders[1]!.x) - shoulderSpan * 0.15);
    right = Math.max(right, Math.max(shoulders[0]!.x, shoulders[1]!.x) + shoulderSpan * 0.15);
  }

  const midShoulderY =
    shoulders.length > 0 ? shoulders.reduce((sum, item) => sum + item.y, 0) / shoulders.length : bottom;
  const hips = [leftHip, rightHip].filter((item): item is PoseLandmark => item != null);
  const midHipY = hips.length > 0 ? hips.reduce((sum, item) => sum + item.y, 0) / hips.length : midShoulderY + 0.22;
  const chest = midShoulderY + Math.max(0.08, (midHipY - midShoulderY) * 0.45);
  bottom = Math.max(bottom, chest);

  const faceHeight = Math.max(0.04, midShoulderY - top);
  top -= faceHeight * 0.35;

  left = clamp(left, 0, 1);
  right = clamp(right, 0, 1);
  top = clamp(top, 0, 1);
  bottom = clamp(bottom, 0, 1);
  if (right - left < 0.02 || bottom - top < 0.02) return null;

  return {
    box: {
      x: left * source.width,
      y: top * source.height,
      width: (right - left) * source.width,
      height: (bottom - top) * source.height,
    },
    confidence: vis.length > 0 ? median(vis) : 0.5,
  };
}

export function stabilizeBoxes(boxes: PixelBox[]): PixelBox | null {
  if (boxes.length === 0) return null;
  return {
    x: median(boxes.map((item) => item.x)),
    y: median(boxes.map((item) => item.y)),
    width: median(boxes.map((item) => item.width)),
    height: median(boxes.map((item) => item.height)),
  };
}

export function sampleTimes(input: {
  durationSec: number;
  tSec?: number;
  sampleEverySec?: number;
  maxSamples?: number;
}): number[] {
  if (input.tSec != null) {
    return [clamp(input.tSec, 0, Math.max(0, input.durationSec - 0.01))];
  }
  const every = input.sampleEverySec != null && input.sampleEverySec > 0 ? input.sampleEverySec : 0.5;
  const max = input.maxSamples != null && input.maxSamples > 0 ? Math.floor(input.maxSamples) : 8;
  const duration = Math.max(0, input.durationSec);
  if (duration <= 0) return [0];
  const times: number[] = [];
  for (let t = Math.min(0.2, duration / 2); t < duration && times.length < max; t += every) {
    times.push(Number(t.toFixed(3)));
  }
  if (times.length === 0) times.push(0);
  return times;
}

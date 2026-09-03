import { createCanvas, loadImage } from "@napi-rs/canvas";
import { existsSync } from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { extractSourceFrame } from "../remotion/engine.js";
import { ToolError } from "../tools/errors.js";
import {
  boxFromLandmarks,
  median,
  sampleTimes,
  stabilizeBoxes,
  type PixelBox,
  type PoseLandmark,
  type TalentBox,
} from "./crop.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const VENDORED_MODEL = path.join(HERE, "models", "pose_landmarker_lite.task");

export function poseModelPath(): string {
  const env = (process.env.CUTSTILL_POSE_MODEL ?? "").trim();
  if (env && existsSync(env)) return env;
  if (existsSync(VENDORED_MODEL)) return VENDORED_MODEL;
  return VENDORED_MODEL;
}

function wasmDir(): string {
  return path.join(path.dirname(fileURLToPath(import.meta.url)), "../../../node_modules/@mediapipe/tasks-vision/wasm");
}

type PoseLandmarkerHandle = {
  detect: (image: unknown) => { landmarks: PoseLandmark[][] };
  close?: () => void;
};

let landmarkerPromise: Promise<PoseLandmarkerHandle> | null = null;

async function loadLandmarker(): Promise<PoseLandmarkerHandle> {
  const modelFile = poseModelPath();
  if (!existsSync(modelFile)) {
    throw new ToolError(
      "TOOL_FAILED",
      "Pose Landmarker Lite model missing. Expected src/lib/talent/models/pose_landmarker_lite.task",
    );
  }
  const wasm = wasmDir();
  if (!existsSync(wasm)) {
    throw new ToolError("TOOL_FAILED", "MediaPipe wasm files are not installed (@mediapipe/tasks-vision)");
  }
  const vision = await import("@mediapipe/tasks-vision");
  const fileset = await vision.FilesetResolver.forVisionTasks(wasm);
  const buffer = new Uint8Array(await readFile(modelFile));
  return vision.PoseLandmarker.createFromOptions(fileset, {
    baseOptions: { modelAssetBuffer: buffer, delegate: "CPU" },
    runningMode: "IMAGE",
    numPoses: 1,
    minPoseDetectionConfidence: 0.4,
    minPosePresenceConfidence: 0.4,
    minTrackingConfidence: 0.4,
  });
}

export async function getPoseLandmarker(): Promise<PoseLandmarkerHandle> {
  if (!landmarkerPromise) {
    landmarkerPromise = loadLandmarker().catch((error) => {
      landmarkerPromise = null;
      throw error;
    });
  }
  return landmarkerPromise;
}

export function resetPoseLandmarker(): void {
  landmarkerPromise = null;
}

export async function detectPoseBoxOnPng(
  pngPath: string,
  source: { width: number; height: number },
): Promise<{ box: PixelBox; confidence: number } | null> {
  const landmarker = await getPoseLandmarker();
  const image = await loadImage(pngPath);
  const canvas = createCanvas(image.width, image.height);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(image, 0, 0);
  const result = landmarker.detect(canvas);
  const landmarks = result.landmarks?.[0];
  if (!landmarks || landmarks.length === 0) return null;
  return boxFromLandmarks(landmarks, source);
}

export async function sampleTalentBox(input: {
  sourcePath: string;
  cacheDir: string;
  durationSec: number;
  sourceWidth: number;
  sourceHeight: number;
  tSec?: number;
  sampleEverySec?: number;
  maxSamples?: number;
}): Promise<TalentBox> {
  const times = sampleTimes({
    durationSec: input.durationSec,
    tSec: input.tSec,
    sampleEverySec: input.sampleEverySec,
    maxSamples: input.maxSamples,
  });
  await mkdir(input.cacheDir, { recursive: true });
  const boxes: PixelBox[] = [];
  const confidences: number[] = [];
  for (const t of times) {
    const dest = path.join(input.cacheDir, `pose-${t.toFixed(3).replace(".", "p")}.png`);
    await extractSourceFrame({ sourcePath: input.sourcePath, fileSec: t, dest });
    const hit = await detectPoseBoxOnPng(dest, {
      width: input.sourceWidth,
      height: input.sourceHeight,
    });
    if (hit) {
      boxes.push(hit.box);
      confidences.push(hit.confidence);
    }
  }
  const stable = stabilizeBoxes(boxes);
  if (!stable) {
    throw new ToolError("FACE_NOT_FOUND", "Pose Landmarker did not find a person in sampled frames");
  }
  return {
    ...stable,
    confidence: confidences.length > 0 ? median(confidences) : 0,
    sampleCount: times.length,
  };
}

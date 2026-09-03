import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
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

const execFileAsync = promisify(execFile);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const VENDORED_MODEL = path.join(HERE, "models", "pose_landmarker_lite.task");
const PY_RUNNER = path.join(HERE, "pose_landmarker.py");

export function poseModelPath(): string {
  const env = (process.env.CUTSTILL_POSE_MODEL ?? "").trim();
  if (env && existsSync(env)) return env;
  return VENDORED_MODEL;
}

export function posePython(): string {
  return (process.env.CUTSTILL_PYTHON ?? "python3").trim() || "python3";
}

export async function detectPoseBoxOnPng(
  pngPath: string,
  source: { width: number; height: number },
): Promise<{ box: PixelBox; confidence: number } | null> {
  const modelFile = poseModelPath();
  if (!existsSync(modelFile)) {
    throw new ToolError(
      "TOOL_FAILED",
      "Pose Landmarker Lite model missing. Expected src/lib/talent/models/pose_landmarker_lite.task",
    );
  }
  if (!existsSync(PY_RUNNER)) {
    throw new ToolError("TOOL_FAILED", "pose_landmarker.py is missing");
  }
  let stdout = "";
  let stderr = "";
  try {
    const result = await execFileAsync(posePython(), [PY_RUNNER, modelFile, pngPath], {
      timeout: 45_000,
      maxBuffer: 2_000_000,
      env: { ...process.env, LIBGL_ALWAYS_SOFTWARE: "1" },
    });
    stdout = result.stdout.toString();
    stderr = result.stderr.toString();
  } catch (error) {
    const err = error as { stdout?: string | Buffer; stderr?: string | Buffer; code?: string | number };
    stdout = String(err.stdout ?? "");
    stderr = String(err.stderr ?? "");
    const blob = `${stdout}\n${stderr}`;
    if (blob.includes("MEDIAPIPE_MISSING") || blob.includes("No module named 'mediapipe'")) {
      throw new ToolError(
        "TOOL_FAILED",
        "MediaPipe is not installed. Live media.face needs: pip install mediapipe",
      );
    }
    throw new ToolError("TOOL_FAILED", (stderr || stdout || "Pose Landmarker failed").slice(0, 400));
  }
  const line = stdout.trim().split(/\r?\n/).filter(Boolean).at(-1) ?? "{}";
  let parsed: { landmarks?: PoseLandmark[]; error?: string };
  try {
    parsed = JSON.parse(line) as { landmarks?: PoseLandmark[]; error?: string };
  } catch {
    throw new ToolError("TOOL_FAILED", "Pose Landmarker returned non-JSON");
  }
  if (parsed.error === "MEDIAPIPE_MISSING") {
    throw new ToolError(
      "TOOL_FAILED",
      "MediaPipe is not installed. Live media.face needs: pip install mediapipe",
    );
  }
  const landmarks = parsed.landmarks ?? [];
  if (landmarks.length === 0) return null;
  return boxFromLandmarks(landmarks, source);
}

export async function sampleTalentBox(input: {
  sourcePath: string;
  cacheDir: string;
  durationSec: number;
  sourceWidth: number;
  sourceHeight: number;
  tSec?: number;
  startSec?: number;
  endSec?: number;
  windows?: Array<{ startSec: number; endSec: number }>;
  sampleEverySec?: number;
  maxSamples?: number;
}): Promise<TalentBox> {
  const times = sampleTimes({
    durationSec: input.durationSec,
    tSec: input.tSec,
    startSec: input.startSec,
    endSec: input.endSec,
    windows: input.windows,
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

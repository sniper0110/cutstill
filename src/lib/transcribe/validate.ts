import { ToolError } from "../tools/errors.js";
import type { SessionTranscript } from "../tools/types.js";

export function assertWordLevelTranscript(transcript: SessionTranscript): void {
  if (!Array.isArray(transcript.words) || transcript.words.length < 2) {
    throw new ToolError("TOOL_FAILED", "transcript must include multiple words with distinct times");
  }
  const spans = new Set(transcript.words.map((word) => `${word.startSec}:${word.endSec}`));
  if (spans.size < 2) {
    throw new ToolError("TOOL_FAILED", "transcript words must have distinct startSec/endSec");
  }
  if (transcript.words.length === 1) {
    const only = transcript.words[0]!;
    if (only.startSec === 0 && Math.abs(only.endSec - transcript.durationSec) < 1e-6) {
      throw new ToolError("TOOL_FAILED", "refusing a single 0–duration transcript blob");
    }
  }
  for (const word of transcript.words) {
    if (!word.text.trim()) {
      throw new ToolError("TOOL_FAILED", "transcript words must have text");
    }
    if (!(word.endSec > word.startSec)) {
      throw new ToolError("TOOL_FAILED", "each word must have endSec > startSec");
    }
  }
}

/** True for the AVE-style single blob `{ text, start: 0, end: duration }`. */
export function isDurationBlob(value: unknown, durationSec: number): boolean {
  if (!value || typeof value !== "object") return false;
  const rec = value as Record<string, unknown>;
  const start = Number(rec.start ?? rec.startSec);
  const end = Number(rec.end ?? rec.endSec);
  const words = rec.words;
  if (Array.isArray(words) && words.length > 1) return false;
  return start === 0 && Number.isFinite(end) && Math.abs(end - durationSec) < 1e-3;
}

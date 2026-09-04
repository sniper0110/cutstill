import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { hashFile } from "../hash.js";
import type { SessionTranscript, ToolsTranscribeResult, TranscriptWord } from "../tools/types.js";
import { assertWordLevelTranscript } from "./validate.js";

const STUB_TOKENS = ["alpha", "bravo", "charlie", "delta", "echo", "foxtrot", "golf", "hotel"];

export function stubTranscript(durationSec: number, language = "en"): SessionTranscript {
  const duration = Math.max(0.4, durationSec);
  const count = Math.max(3, Math.min(STUB_TOKENS.length, Math.floor(duration / 0.35) || 3));
  const step = duration / count;
  const words: TranscriptWord[] = [];
  for (let i = 0; i < count; i += 1) {
    const startSec = Number((i * step).toFixed(3));
    const endSec = Number(Math.min(duration, startSec + step * 0.75).toFixed(3));
    words.push({
      text: STUB_TOKENS[i % STUB_TOKENS.length]!,
      startSec,
      endSec,
      confidence: 0.99,
    });
  }
  const transcript: SessionTranscript = {
    language,
    durationSec: duration,
    words,
    utterances: [
      {
        text: words.map((word) => word.text).join(" "),
        startSec: words[0]!.startSec,
        endSec: words[words.length - 1]!.endSec,
      },
    ],
  };
  assertWordLevelTranscript(transcript);
  return transcript;
}

function cachePath(cacheRoot: string, sourceHash: string): string {
  return path.join(cacheRoot, `transcript-${sourceHash}.json`);
}

export async function readTranscriptCache(
  cacheRoot: string,
  sourceHash: string,
): Promise<SessionTranscript | null> {
  const file = cachePath(cacheRoot, sourceHash);
  if (!existsSync(file)) return null;
  try {
    const parsed = JSON.parse(await readFile(file, "utf8")) as SessionTranscript;
    assertWordLevelTranscript(parsed);
    return parsed;
  } catch {
    return null;
  }
}

export async function writeTranscriptCache(
  cacheRoot: string,
  sourceHash: string,
  transcript: SessionTranscript,
): Promise<void> {
  await mkdir(cacheRoot, { recursive: true });
  await writeFile(cachePath(cacheRoot, sourceHash), JSON.stringify({ ...transcript, sourceHash }, null, 2), "utf8");
}

function hasLiveKey(): boolean {
  return Boolean(process.env.DEEPGRAM_API_KEY || process.env.CUTSTILL_STT_KEY);
}

interface DeepgramWord {
  word?: string;
  punctuated_word?: string;
  start?: number;
  end?: number;
  confidence?: number;
}

interface DeepgramUtterance {
  transcript?: string;
  start?: number;
  end?: number;
  speaker?: number;
}

async function transcribeDeepgram(filePath: string, durationSec: number): Promise<SessionTranscript> {
  const key = process.env.DEEPGRAM_API_KEY || process.env.CUTSTILL_STT_KEY;
  if (!key) {
    return stubTranscript(durationSec);
  }
  const bytes = await readFile(filePath);
  const url = new URL("https://api.deepgram.com/v1/listen");
  url.searchParams.set("model", process.env.DEEPGRAM_MODEL ?? "nova-2");
  url.searchParams.set("smart_format", "true");
  url.searchParams.set("utterances", "true");
  url.searchParams.set("punctuate", "true");
  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Token ${key}`,
      "Content-Type": "application/octet-stream",
    },
    body: bytes,
  });
  if (!response.ok) {
    throw new Error(`Deepgram ${response.status}`);
  }
  const payload = (await response.json()) as {
    results?: {
      channels?: Array<{ alternatives?: Array<{ words?: DeepgramWord[]; transcript?: string }> }>;
      utterances?: DeepgramUtterance[];
    };
    metadata?: { duration?: number };
  };
  const wordsRaw = payload.results?.channels?.[0]?.alternatives?.[0]?.words ?? [];
  const words: TranscriptWord[] = wordsRaw
    .map((word) => ({
      text: String(word.punctuated_word ?? word.word ?? "").trim(),
      startSec: Number(word.start ?? 0),
      endSec: Number(word.end ?? 0),
      confidence: typeof word.confidence === "number" ? word.confidence : undefined,
    }))
    .filter((word) => word.text && word.endSec > word.startSec);
  const utterances = (payload.results?.utterances ?? []).map((utterance) => ({
    text: String(utterance.transcript ?? "").trim(),
    startSec: Number(utterance.start ?? 0),
    endSec: Number(utterance.end ?? 0),
    speaker: utterance.speaker != null ? String(utterance.speaker) : undefined,
  }));
  const transcript: SessionTranscript = {
    language: "en",
    durationSec: Number(payload.metadata?.duration ?? durationSec),
    words,
    utterances: utterances.length > 0 ? utterances : undefined,
  };
  assertWordLevelTranscript(transcript);
  return transcript;
}

export async function transcribeSource(input: {
  filePath: string;
  durationSec: number;
  cacheRoot: string;
  skipNetwork?: boolean;
}): Promise<ToolsTranscribeResult> {
  const sourceHash = await hashFile(input.filePath);
  const cached = await readTranscriptCache(input.cacheRoot, sourceHash);
  if (cached) {
    return { ...cached, sourceHash, cached: true };
  }

  const live = hasLiveKey() && !input.skipNetwork && process.env.CUTSTILL_STT !== "stub" && !process.env.VITEST;
  const transcript = live
    ? await transcribeDeepgram(input.filePath, input.durationSec)
    : stubTranscript(input.durationSec);
  await writeTranscriptCache(input.cacheRoot, sourceHash, { ...transcript, sourceHash });
  return { ...transcript, sourceHash, cached: false };
}

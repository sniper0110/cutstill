import { describe, expect, it } from "vitest";
import { stubTranscript } from "../src/lib/transcribe/index.js";
import { assertWordLevelTranscript, isDurationBlob } from "../src/lib/transcribe/validate.js";
import { invokeTool } from "../src/lib/tools/index.js";
import { createSession, ctxFor, tempSessionsRoot } from "./helpers.js";

describe("media.transcribe", () => {
  it("returns multiple words with distinct startSec/endSec", async () => {
    const root = await tempSessionsRoot();
    const { sessionId } = await createSession(root);
    const result = (await invokeTool("media.transcribe", { sessionId }, ctxFor(root))) as {
      language: string;
      durationSec: number;
      words: Array<{ text: string; startSec: number; endSec: number }>;
    };
    expect(result.language).toBeTruthy();
    expect(result.durationSec).toBeGreaterThan(1);
    expect(result.words.length).toBeGreaterThanOrEqual(3);
    const spans = new Set(result.words.map((word) => `${word.startSec}:${word.endSec}`));
    expect(spans.size).toBeGreaterThanOrEqual(2);
    expect(result.words[0]!.startSec).toBeLessThan(result.words[1]!.startSec);
    expect(isDurationBlob(result, result.durationSec)).toBe(false);
    assertWordLevelTranscript(result);
  });

  it("fails a single 0–duration blob (AVE transcript regression)", () => {
    const durationSec = 742;
    const blob = { language: "en", durationSec, words: [{ text: "whole file", startSec: 0, endSec: durationSec }] };
    expect(isDurationBlob({ text: "whole file", start: 0, end: durationSec }, durationSec)).toBe(true);
    expect(() => assertWordLevelTranscript(blob)).toThrow(/distinct|multiple/i);
  });

  it("caches by source hash", async () => {
    const root = await tempSessionsRoot();
    const { sessionId } = await createSession(root);
    const first = (await invokeTool("media.transcribe", { sessionId }, ctxFor(root))) as { cached: boolean };
    const second = (await invokeTool("media.transcribe", { sessionId }, ctxFor(root))) as { cached: boolean };
    expect(first.cached).toBe(false);
    expect(second.cached).toBe(true);
  });

  it("stub itself is word-level", () => {
    const transcript = stubTranscript(3);
    expect(transcript.words.length).toBeGreaterThanOrEqual(3);
    expect(transcript.words[0]!.endSec).toBeLessThan(transcript.words[transcript.words.length - 1]!.endSec);
  });
});

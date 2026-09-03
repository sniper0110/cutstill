import { describe, expect, it } from "vitest";
import {
  estimateFalGenerateCost,
  estimatePublishCost,
  estimateStillCost,
  estimateTranscribeCost,
  estimateWindowCost,
  readFalVendorCost,
  resolveFalCharge,
} from "../src/lib/cost/meter.js";
import { COST_RATES } from "../src/lib/cost/rates.js";
import { invokeTool } from "../src/lib/tools/index.js";
import { createSession, ctxFor, tempSessionsRoot } from "./helpers.js";

describe("rate card math", () => {
  it("prices still, window, and publish from documented constants", () => {
    expect(estimateStillCost()).toBe(COST_RATES.stillUsd);
    expect(estimateWindowCost(2.5)).toBe(2.5 * COST_RATES.windowUsdPerSec);
    expect(estimatePublishCost(10)).toBe(10 * COST_RATES.publishUsdPerSec);
    expect(estimateWindowCost(0)).toBe(0);
  });

  it("fal fallback uses duration, resolution, and optional audio", () => {
    expect(estimateFalGenerateCost({ durationSec: 5, resolution: "480p" })).toBeCloseTo(
      5 * COST_RATES.falUsdPerSec["480p"],
      6,
    );
    expect(estimateFalGenerateCost({ durationSec: 6, resolution: "720p", generateAudio: true })).toBeCloseTo(
      6 * (COST_RATES.falUsdPerSec["720p"] + COST_RATES.falAudioUsdPerSec),
      6,
    );
  });

  it("prefers Fal vendor cost over the estimate", () => {
    expect(readFalVendorCost({ cost: 0.042, video: { url: "https://cdn.example.test/x.mp4" } })).toBe(0.042);
    expect(readFalVendorCost({ metrics: { cost_usd: "0.11" } })).toBe(0.11);
    const vendor = resolveFalCharge({ vendorUsd: 0.042, durationSec: 5, resolution: "480p" });
    expect(vendor.costUsd).toBe(0.042);
    expect(vendor.estimated).toBe(false);
    const fallback = resolveFalCharge({ durationSec: 5, resolution: "480p" });
    expect(fallback.costUsd).toBe(5 * COST_RATES.falUsdPerSec["480p"]);
    expect(fallback.estimated).toBe(true);
  });

  it("transcribe is 0 when cached or stubbed", () => {
    expect(estimateTranscribeCost({ durationSec: 120, cached: true })).toBe(0);
    expect(estimateTranscribeCost({ durationSec: 120, stub: true })).toBe(0);
    expect(estimateTranscribeCost({ durationSec: 120 })).toBe(2 * COST_RATES.transcribeUsdPerMin);
  });
});

describe("tool results expose cost", () => {
  it("render.still charges the still rate and sessionTotalUsd accumulates", async () => {
    const root = await tempSessionsRoot("cutstill-cost-still-");
    const { sessionId } = await createSession(root);
    const first = (await invokeTool("render.still", { sessionId, tSec: 0.4 }, ctxFor(root))) as {
      cost: { costUsd: number; currency: string; sessionTotalUsd: number };
    };
    expect(first.cost.currency).toBe("USD");
    expect(first.cost.costUsd).toBe(COST_RATES.stillUsd);
    expect(first.cost.costUsd).toBeGreaterThan(0);
    expect(first.cost.sessionTotalUsd).toBe(COST_RATES.stillUsd);

    const second = (await invokeTool("render.still", { sessionId, tSec: 0.8 }, ctxFor(root))) as {
      cost: { costUsd: number; sessionTotalUsd: number };
    };
    expect(second.cost.costUsd).toBe(COST_RATES.stillUsd);
    expect(second.cost.sessionTotalUsd).toBe(COST_RATES.stillUsd * 2);

    const rollup = (await invokeTool("session.cost", { sessionId }, ctxFor(root))) as {
      totalUsd: number;
      byTool: Record<string, { count: number; costUsd: number }>;
      cost: { costUsd: number; sessionTotalUsd: number };
    };
    expect(rollup.totalUsd).toBe(COST_RATES.stillUsd * 2);
    expect(rollup.byTool["render.still"]?.count).toBe(2);
    expect(rollup.byTool["render.still"]?.costUsd).toBe(COST_RATES.stillUsd * 2);
    expect(rollup.cost.costUsd).toBe(0);
    expect(rollup.cost.sessionTotalUsd).toBe(COST_RATES.stillUsd * 2);
  }, 90_000);

  it("cached transcribe is $0", async () => {
    const root = await tempSessionsRoot("cutstill-cost-stt-");
    const { sessionId } = await createSession(root);
    const first = (await invokeTool("media.transcribe", { sessionId }, ctxFor(root))) as {
      cached: boolean;
      cost: { costUsd: number };
    };
    const second = (await invokeTool("media.transcribe", { sessionId }, ctxFor(root))) as {
      cached: boolean;
      cost: { costUsd: number };
    };
    expect(first.cached).toBe(false);
    expect(first.cost.costUsd).toBe(0);
    expect(second.cached).toBe(true);
    expect(second.cost.costUsd).toBe(0);
  });

  it("fal.generate prefers mocked vendor cost over the estimate", async () => {
    const root = await tempSessionsRoot("cutstill-cost-fal-");
    const { sessionId } = await createSession(root);
    const { readFile } = await import("node:fs/promises");
    const { ensureStandInMp4 } = await import("./helpers.js");
    const standin = await readFile(await ensureStandInMp4());
    const falHttp = async (req: { method: string; url: string }) => {
      if (req.method === "POST" && req.url.includes("queue.fal.run")) {
        return { status: 200, json: { request_id: "job-cost-1" } };
      }
      if (req.url.includes("/status")) return { status: 200, json: { status: "COMPLETED" } };
      if (req.url.includes("/requests/")) {
        return {
          status: 200,
          json: { video: { url: "https://cdn.example.test/fal-out.mp4" }, cost: 0.042 },
        };
      }
      if (req.url.includes("cdn.example.test")) return { status: 200, bytes: standin };
      return { status: 404, json: { detail: "not mocked" } };
    };
    const submitted = (await invokeTool(
      "fal.generate",
      {
        sessionId,
        modelId: "bytedance/seedance-2.5/text-to-video",
        prompt: "lantern",
        duration: 5,
        resolution: "480p",
      },
      ctxFor(root, { skipNetwork: true, falKey: "test-key", falHttp }),
    )) as { cost: { costUsd: number }; costUsd?: number };
    expect(submitted.cost.costUsd).toBe(0.042);
    expect(submitted.costUsd).toBe(0.042);
    const estimate = estimateFalGenerateCost({ durationSec: 5, resolution: "480p" });
    expect(submitted.cost.costUsd).not.toBe(estimate);
  });
});

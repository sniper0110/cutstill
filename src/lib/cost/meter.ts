import { COST_CURRENCY, COST_RATES } from "./rates.js";
import type { UsageEvent } from "../tools/types.js";

export interface CallCost {
  costUsd: number;
  currency: typeof COST_CURRENCY;
  sessionTotalUsd: number;
}

export interface SessionCostReport {
  currency: typeof COST_CURRENCY;
  totalUsd: number;
  byTool: Record<string, { count: number; costUsd: number }>;
  entries: UsageEvent[];
}

export function money(n: number): number {
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.round(n * 1_000_000) / 1_000_000;
}

export function sessionTotalUsd(usage: UsageEvent[] | undefined): number {
  return money((usage ?? []).reduce((sum, item) => sum + (item.costUsd || 0), 0));
}

export function summarizeUsage(usage: UsageEvent[] | undefined): SessionCostReport {
  const entries = usage ?? [];
  const byTool: Record<string, { count: number; costUsd: number }> = {};
  for (const item of entries) {
    const bucket = byTool[item.action] ?? { count: 0, costUsd: 0 };
    bucket.count += 1;
    bucket.costUsd = money(bucket.costUsd + (item.costUsd || 0));
    byTool[item.action] = bucket;
  }
  return {
    currency: COST_CURRENCY,
    totalUsd: sessionTotalUsd(entries),
    byTool,
    entries,
  };
}

export function estimateStillCost(): number {
  return money(COST_RATES.stillUsd);
}

export function estimateWindowCost(durationSec: number): number {
  return money(Math.max(0, durationSec) * COST_RATES.windowUsdPerSec);
}

export function estimatePublishCost(durationSec: number): number {
  return money(Math.max(0, durationSec) * COST_RATES.publishUsdPerSec);
}

export function estimateTranscribeCost(input: {
  durationSec: number;
  cached?: boolean;
  stub?: boolean;
}): number {
  if (input.cached || input.stub) return 0;
  return money((Math.max(0, input.durationSec) / 60) * COST_RATES.transcribeUsdPerMin);
}

export function estimateFaceCost(): number {
  return money(COST_RATES.mediaFaceUsd);
}

export function estimateFalGenerateCost(input: {
  durationSec?: number;
  resolution?: string;
  generateAudio?: boolean;
}): number {
  const seconds = input.durationSec != null && input.durationSec > 0 ? input.durationSec : 5;
  const res = input.resolution === "480p" ? "480p" : "720p";
  const perSec = COST_RATES.falUsdPerSec[res] ?? COST_RATES.falUsdPerSec["720p"]!;
  const audio = input.generateAudio ? COST_RATES.falAudioUsdPerSec : 0;
  return money(seconds * (perSec + audio));
}

/** Prefer vendor fields on a Fal JSON body. Never reads env keys. */
export function readFalVendorCost(json: unknown): number | undefined {
  if (!json || typeof json !== "object" || Array.isArray(json)) return undefined;
  const rec = json as Record<string, unknown>;
  const direct = pickUsd(rec.cost) ?? pickUsd(rec.cost_usd) ?? pickUsd(rec.costUsd);
  if (direct != null) return direct;
  if (rec.metrics && typeof rec.metrics === "object" && !Array.isArray(rec.metrics)) {
    const metrics = rec.metrics as Record<string, unknown>;
    return pickUsd(metrics.cost) ?? pickUsd(metrics.cost_usd) ?? pickUsd(metrics.costUsd);
  }
  return undefined;
}

function pickUsd(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) return money(value);
  if (typeof value === "string" && value.trim()) {
    const n = Number(value);
    if (Number.isFinite(n) && n >= 0) return money(n);
  }
  return undefined;
}

export function resolveFalCharge(input: {
  vendorUsd?: number;
  durationSec?: number;
  resolution?: string;
  generateAudio?: boolean;
}): { costUsd: number; estimated: boolean } {
  if (input.vendorUsd != null && input.vendorUsd > 0) {
    return { costUsd: money(input.vendorUsd), estimated: false };
  }
  return {
    costUsd: estimateFalGenerateCost(input),
    estimated: true,
  };
}

export function attachCallCost<T>(
  result: T,
  input: { costUsd: number; sessionTotalUsd: number },
): T extends object ? T & { cost: CallCost } : { value: T; cost: CallCost } {
  const cost: CallCost = {
    costUsd: money(input.costUsd),
    currency: COST_CURRENCY,
    sessionTotalUsd: money(input.sessionTotalUsd),
  };
  if (result && typeof result === "object" && !Array.isArray(result)) {
    return { ...(result as object), cost } as T extends object ? T & { cost: CallCost } : { value: T; cost: CallCost };
  }
  return { value: result, cost } as T extends object ? T & { cost: CallCost } : { value: T; cost: CallCost };
}

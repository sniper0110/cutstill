/**
 * Cutstill rate card (USD). Agents report these on every tool result.
 * Constants only — no env, no provider SDK, no keys.
 *
 * Render rates are estimated local compute, not a cloud invoice.
 * Fal generate prefers a vendor figure on the Fal payload when present.
 * Transcribe is $0 for stub/cached; live STT uses the per-minute rate.
 * media.face is a small compute estimate (not free, not a vendor invoice).
 * Session / timeline / comp mutations are $0.
 */
export const COST_CURRENCY = "USD" as const;

export const COST_RATES = {
  /** Per render.still */
  stillUsd: 0.002,
  /** Per output-second of render.window */
  windowUsdPerSec: 0.008,
  /** Per output-second of render.publish */
  publishUsdPerSec: 0.012,
  /** Live STT per minute of source. Stub and cache are 0. */
  transcribeUsdPerMin: 0.006,
  /** Pose sample + box. Documented compute estimate. */
  mediaFaceUsd: 0.001,
  /** Fallback when Fal does not return a vendor cost. */
  falUsdPerSec: {
    "480p": 0.03,
    "720p": 0.06,
  } as Record<string, number>,
  falAudioUsdPerSec: 0.01,
} as const;

export type CostCurrency = typeof COST_CURRENCY;

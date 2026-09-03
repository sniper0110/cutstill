import { keptInWindow, mapSourceTime, type KeptRange } from "../time.js";
import type { SessionComp } from "../tools/types.js";

export interface CompSequence {
  id: string;
  from: number;
  duration: number;
  trimBefore: number;
  /** Slice rate: authored composition time advances in source seconds, not output time. */
  playbackRate: number;
}

/**
 * Place each authored comp on the output timeline and keep useCurrentFrame
 * aligned to source seconds inside that comp's window.
 *
 * `from` / `duration` are output frames (after cuts and speed) so the overlay
 * stays on the sped talent track.
 * `trimBefore` is the composition frame at the first overlapping source second.
 * `playbackRate` is the kept-slice rate so useCurrentFrame still spans the
 * source-second length (a 12s window at 1.1× does not end 1.09s early).
 */
export function planCompSequences(input: {
  comps: SessionComp[];
  startSec: number;
  endSec: number;
  fps: number;
  ranges: KeptRange[];
}): CompSequence[] {
  const slices = keptInWindow(input.ranges, input.startSec, input.endSec);
  const windowFileStart = mapSourceTime(input.startSec, input.ranges).fileSec;
  const pieces =
    slices.length > 0
      ? slices
      : [{ startSec: input.startSec, endSec: input.endSec, rate: 1 }];
  const planned: CompSequence[] = [];
  for (const comp of input.comps) {
    for (const slice of pieces) {
      const overlapStart = Math.max(comp.window.startSec, slice.startSec);
      const overlapEnd = Math.min(comp.window.endSec, slice.endSec);
      if (overlapEnd <= overlapStart + 1e-4) continue;
      const fileStart = mapSourceTime(overlapStart, input.ranges).fileSec;
      const fileEnd = mapSourceTime(overlapEnd, input.ranges).fileSec;
      if (fileEnd <= fileStart + 1e-4) continue;
      planned.push({
        id: comp.id,
        from: Math.max(0, Math.round((fileStart - windowFileStart) * input.fps)),
        duration: Math.max(1, Math.round((fileEnd - fileStart) * input.fps)),
        trimBefore: Math.max(0, Math.round((overlapStart - comp.window.startSec) * input.fps)),
        playbackRate: slice.rate > 0 ? slice.rate : 1,
      });
    }
  }
  return planned;
}

/** Single-frame still at a source second; reuses window/publish sequence planning. */
export function planStillCompSequences(input: {
  comps: SessionComp[];
  tSec: number;
  fps: number;
  ranges: KeptRange[];
}): CompSequence[] {
  const tick = 1 / Math.max(1, input.fps);
  return planCompSequences({
    comps: input.comps,
    startSec: input.tSec,
    endSec: input.tSec + tick,
    fps: input.fps,
    ranges: input.ranges,
  });
}

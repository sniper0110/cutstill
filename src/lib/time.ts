import type { SessionTimeline, SourceRange, SpeedWindow } from "./tools/types.js";
import { defaultTimeline } from "./tools/types.js";

export interface KeptRange {
  startSec: number;
  endSec: number;
  rate: number;
}

function subtractRange(range: SourceRange, cut: SourceRange): SourceRange[] {
  if (cut.endSec <= range.startSec || cut.startSec >= range.endSec) return [range];
  const out: SourceRange[] = [];
  if (cut.startSec > range.startSec) {
    out.push({ startSec: range.startSec, endSec: Math.min(range.endSec, cut.startSec) });
  }
  if (cut.endSec < range.endSec) {
    out.push({ startSec: Math.max(range.startSec, cut.endSec), endSec: range.endSec });
  }
  return out.filter((item) => item.endSec - item.startSec > 1e-4);
}

function clipToDuration(range: SourceRange, duration: number): SourceRange | null {
  const startSec = Math.max(0, range.startSec);
  const endSec = Math.min(duration, range.endSec);
  return endSec > startSec ? { startSec, endSec } : null;
}

function overlaps(a: SourceRange, b: SourceRange): boolean {
  return a.startSec < b.endSec && a.endSec > b.startSec;
}

/** Subtract keep windows from a cut so protected source is never removed. */
function cutFragmentsOutsideKeeps(cut: SourceRange, keeps: SourceRange[]): SourceRange[] {
  let fragments: SourceRange[] = [cut];
  for (const keep of keeps) {
    fragments = fragments.flatMap((fragment) => subtractRange(fragment, keep));
  }
  return fragments;
}

function splitRangeByKeeps(range: SourceRange, keeps: SourceRange[]): SourceRange[] {
  let pieces: SourceRange[] = [range];
  for (const keep of keeps) {
    const next: SourceRange[] = [];
    for (const piece of pieces) {
      if (!overlaps(piece, keep)) {
        next.push(piece);
        continue;
      }
      const overlapStart = Math.max(piece.startSec, keep.startSec);
      const overlapEnd = Math.min(piece.endSec, keep.endSec);
      if (piece.startSec < overlapStart) {
        next.push({ startSec: piece.startSec, endSec: overlapStart });
      }
      next.push({ startSec: overlapStart, endSec: overlapEnd });
      if (piece.endSec > overlapEnd) {
        next.push({ startSec: overlapEnd, endSec: piece.endSec });
      }
    }
    pieces = next;
  }
  return pieces.filter((piece) => piece.endSec - piece.startSec > 1e-4);
}

function isProtected(range: SourceRange, keeps: SourceRange[]): boolean {
  return keeps.some(
    (keep) => range.startSec >= keep.startSec - 1e-9 && range.endSec <= keep.endSec + 1e-9,
  );
}

function rateAt(range: SourceRange, timeline: SessionTimeline): number {
  if (isProtected(range, timeline.keeps)) return 1;
  const hit = timeline.speedWindows.find(
    (window) => window.startSec < range.endSec && window.endSec > range.startSec,
  );
  if (hit && hit.rate > 0) return hit.rate;
  return timeline.speed > 0 ? timeline.speed : 1;
}

/**
 * Playable source ranges after cuts. `keeps` are protected windows:
 * exempt from removes, forced to 1.0×. They do not isolate the timeline.
 */
export function computeKeptRanges(sourceDuration: number, timeline: SessionTimeline): KeptRange[] {
  const duration = Math.max(0, sourceDuration);
  const keeps = timeline.keeps
    .map((keep) => clipToDuration(keep, duration))
    .filter((keep): keep is SourceRange => keep != null);

  let ranges: SourceRange[] = [{ startSec: 0, endSec: duration }];
  for (const cut of timeline.removes) {
    const clipped = clipToDuration(cut, duration);
    if (!clipped) continue;
    const fragments = cutFragmentsOutsideKeeps(clipped, keeps);
    for (const fragment of fragments) {
      ranges = ranges.flatMap((range) => subtractRange(range, fragment));
    }
  }

  return ranges
    .flatMap((range) => splitRangeByKeeps(range, keeps))
    .filter((range) => range.endSec > range.startSec)
    .map((range) => ({
      ...range,
      rate: rateAt(range, timeline),
    }));
}

export function outputDuration(ranges: KeptRange[]): number {
  return ranges.reduce((sum, range) => sum + (range.endSec - range.startSec) / (range.rate || 1), 0);
}

export function keptInWindow(ranges: KeptRange[], startSec: number, endSec: number): KeptRange[] {
  return ranges
    .map((range) => ({
      startSec: Math.max(range.startSec, startSec),
      endSec: Math.min(range.endSec, endSec),
      rate: range.rate,
    }))
    .filter((range) => range.endSec - range.startSec > 1e-4);
}

/**
 * Map a source-second timestamp through kept ranges + speed onto output file time.
 * Gaps (removed source) contribute 0. Identity when ranges are empty and rate is 1.
 */
export function mapSourceTime(
  tSec: number,
  ranges?: KeptRange[],
  fallbackRate = 1,
): { tSec: number; fileSec: number } {
  const t = Number.isFinite(tSec) ? Math.max(0, tSec) : 0;
  const rate = fallbackRate > 0 ? fallbackRate : 1;
  if (!ranges || ranges.length === 0) {
    return { tSec: t, fileSec: t / rate };
  }
  let out = 0;
  for (const range of ranges) {
    const sliceRate = range.rate > 0 ? range.rate : rate;
    if (t < range.startSec) {
      return { tSec: t, fileSec: out };
    }
    if (t <= range.endSec + 1e-9) {
      return { tSec: t, fileSec: out + (t - range.startSec) / sliceRate };
    }
    out += (range.endSec - range.startSec) / sliceRate;
  }
  return { tSec: t, fileSec: out };
}

export function mapSessionTime(
  tSec: number,
  sourceDuration: number,
  timeline: SessionTimeline = defaultTimeline(),
): { tSec: number; fileSec: number } {
  const ranges = computeKeptRanges(sourceDuration, timeline);
  const fallback = timeline.speed > 0 ? timeline.speed : 1;
  return mapSourceTime(tSec, ranges, fallback);
}

export function isIdentityTimeline(timeline: SessionTimeline): boolean {
  const speed = timeline.speed > 0 ? timeline.speed : 1;
  return timeline.removes.length === 0 && Math.abs(speed - 1) < 1e-9 && timeline.speedWindows.length === 0;
}

export function mergeSpeedWindow(existing: SpeedWindow[], next: SpeedWindow): SpeedWindow[] {
  return [...existing.filter((item) => item.startSec !== next.startSec || item.endSec !== next.endSec), next];
}

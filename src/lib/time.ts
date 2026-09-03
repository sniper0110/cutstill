/**
 * Identity time mapping until timeline mutation tools exist.
 * fileSec === tSec when there are no cuts.
 */
export function mapSourceTime(tSec: number): { tSec: number; fileSec: number } {
  const t = Number.isFinite(tSec) ? Math.max(0, tSec) : 0;
  return { tSec: t, fileSec: t };
}

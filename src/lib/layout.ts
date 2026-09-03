import type { SessionCaption, SessionLayout } from "./tools/types.js";

export const STACK_CANVAS_WIDTH = 1080;
export const STACK_CANVAS_HEIGHT = 1920;

function even(n: number): number {
  return Math.max(2, Math.round(n / 2) * 2);
}

export function stackFractions(layout?: SessionLayout): { graphics: number; talent: number } {
  const graphicsIn = layout?.stack?.graphics;
  const talentIn = layout?.stack?.talent;
  const graphics = graphicsIn ?? (talentIn != null ? 1 - talentIn : 0.5);
  const talent = talentIn ?? 1 - graphics;
  return { graphics, talent };
}

/** Output canvas: explicit layout size, else 1080×1920 for stack, else the source size. */
export function layoutCanvasSize(
  layout: SessionLayout | undefined,
  fallback: { width: number; height: number },
): { width: number; height: number } {
  const width = layout?.width;
  const height = layout?.height;
  if (typeof width === "number" && width > 0 && typeof height === "number" && height > 0) {
    return { width: even(width), height: even(height) };
  }
  if ((layout?.mode ?? "full") === "stack") {
    return { width: STACK_CANVAS_WIDTH, height: STACK_CANVAS_HEIGHT };
  }
  return { width: fallback.width, height: fallback.height };
}

export function captionsCovering(captions: SessionCaption[] | undefined, tSec: number): SessionCaption[] {
  return (captions ?? []).filter((item) => tSec >= item.startSec && tSec < item.endSec);
}

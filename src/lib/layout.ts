import type { CropLayout, SessionCaption, SessionLayout } from "./tools/types.js";

export const STACK_CANVAS_WIDTH = 1080;
export const STACK_CANVAS_HEIGHT = 1920;
export const DEFAULT_CAPTION_BAND_HEIGHT = 64;
export const DEFAULT_CAPTION_FONT_SIZE = 42;

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

/** Cover-crop a pane from a caller crop rect (fractions 0–1, or pixel origin). */
export function cropSourceImgStyle(crop: CropLayout): string {
  const { x, y, width, height } = crop;
  const frac = width <= 1 && height <= 1;
  const originX = frac ? `${(x / width) * 100}` : String(x);
  const originY = frac ? `${(y / height) * 100}` : String(y);
  const scale = frac ? 1 / width : 1;
  return `width:"100%",height:"100%",objectFit:"cover",transformOrigin:"${originX}% ${originY}%",transform:"scale(${scale})"`;
}

export const STACK_DIVIDER_PX = 4;

/** Horizontal seam line under stack. Color is caller palette.divider only. */
export function captionBandHeight(layout?: SessionLayout): number {
  const raw = layout?.bandHeight;
  return typeof raw === "number" && raw > 0 ? Math.round(raw) : DEFAULT_CAPTION_BAND_HEIGHT;
}

export function captionFontSize(layout?: SessionLayout): number {
  const raw = layout?.captionFontSize;
  return typeof raw === "number" && raw > 0 ? Math.round(raw) : DEFAULT_CAPTION_FONT_SIZE;
}

export function stackDividerTop(layout: SessionLayout | undefined, height: number, linePx = STACK_DIVIDER_PX): number {
  const seam = stackFractions(layout).graphics;
  return Math.max(0, Math.round(seam * height - linePx / 2));
}

import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { ensureStandInMp4 } from "../scripts/generate-fixtures.js";
import { defaultToolsContext, invokeTool } from "../src/lib/tools/index.js";
import type { ToolsContext } from "../src/lib/tools/types.js";

export { ensureStandInMp4 };

export const MOVING_TSX = `import React from "react";
import { interpolate, useCurrentFrame, useVideoConfig } from "remotion";

export default function Slide() {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const x = interpolate(frame, [0, fps], [40, 200], { extrapolateRight: "clamp" });
  return (
    <div
      style={{
        position: "absolute",
        left: x,
        top: 40,
        width: 80,
        height: 80,
        background: "#00ff66",
      }}
    />
  );
}
`;

/** useCurrentFrame-driven mark: frame 0 and later frames occupy different x. */
export const CLOCK_TSX = `import React from "react";
import { useCurrentFrame } from "remotion";

export default function Clock() {
  const frame = useCurrentFrame();
  const x = (frame * 7) % 560;
  return (
    <div
      style={{
        position: "absolute",
        left: x,
        top: 8,
        width: 28,
        height: 28,
        background: "#ff0033",
      }}
    />
  );
}
`;

/** Sample x for CLOCK_TSX mark center at a source second (30fps). */
export function clockMarkSampleX(tSec: number, fps = 30): number {
  return ((Math.round(tSec * fps) * 7) % 560) + 10;
}

/** Visible only in the last source second of a 12s window (useCurrentFrame). */
export const LATE_CUE_TSX = `import React from "react";
import { useCurrentFrame, useVideoConfig } from "remotion";

export default function LateCue() {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const seconds = frame / fps;
  if (seconds < 11) return null;
  return (
    <div
      style={{
        position: "absolute",
        left: 480,
        top: 20,
        width: 120,
        height: 80,
        background: "#ff0033",
      }}
    />
  );
}
`;

export const MARKER_TSX = `import React from "react";

export default function Marker(props: { color?: string }) {
  const color = props.color ?? "#ff0033";
  return (
    <div
      style={{
        position: "absolute",
        left: 40,
        top: 40,
        width: 120,
        height: 80,
        background: color,
      }}
    />
  );
}
`;

export async function tempSessionsRoot(label = "cutstill-"): Promise<string> {
  return mkdtemp(path.join(tmpdir(), label));
}

export function ctxFor(sessionsRoot: string, extra: Partial<ToolsContext> = {}): ToolsContext {
  return defaultToolsContext({ sessionsRoot, skipNetwork: true, ...extra });
}

export async function createSession(sessionsRoot: string, sourcePath?: string) {
  const source = sourcePath ?? (await ensureStandInMp4());
  const ctx = ctxFor(sessionsRoot);
  return invokeTool("session.create", { sourcePath: source }, ctx) as Promise<{
    sessionId: string;
    sourcePath: string;
    comps: unknown[];
    usage: unknown[];
    paths: Record<string, string>;
  }>;
}

export async function writeBrief(root: string, body: string): Promise<string> {
  const dest = path.join(root, "notes.md");
  await writeFile(dest, body, "utf8");
  return dest;
}

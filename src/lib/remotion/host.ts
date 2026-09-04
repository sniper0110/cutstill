import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  captionBandHeight,
  captionFontSize,
  cropSourceImgStyle,
  STACK_DIVIDER_PX,
  stackDividerTop,
  stackFractions,
} from "../layout.js";
import type { SessionCaptionWord, SessionComp, SessionLayout } from "../tools/types.js";
import type { CompSequence } from "./sequences.js";

export interface CaptionCue {
  text: string;
  from?: number;
  duration?: number;
  words?: SessionCaptionWord[];
  sourceStartSec?: number;
}

export function layoutStyle(layout?: SessionLayout): {
  sourceWrap: string;
  overlayWrap: string;
  divider: string;
  sourceImg: string;
} {
  const mode = layout?.mode ?? "full";
  if (mode === "split") {
    const talent = layout?.split?.talent;
    const graphics = layout?.split?.graphics;
    const left = talent ?? (graphics != null ? 1 - graphics : 1);
    const right = graphics ?? (talent != null ? 1 - talent : 0);
    const dividerPx = layout?.split?.dividerPx ?? 0;
    const dividerColor = layout?.palette?.divider ?? "#ffffff";
    const pct = (n: number) => {
      const value = n * 100;
      return Number.isInteger(value) ? `${value}%` : `${Number(value.toFixed(4))}%`;
    };
    return {
      sourceWrap: `position:"relative",width:"${pct(left)}",height:"100%",flexShrink:0`,
      overlayWrap: `position:"relative",width:"${pct(right)}",height:"100%",flexShrink:0`,
      divider:
        dividerPx > 0
          ? `<div style={{ width: ${dividerPx}, height: "100%", background: ${JSON.stringify(dividerColor)}, flexShrink: 0 }} />`
          : "",
      sourceImg: `width:"100%",height:"100%",objectFit:"cover"`,
    };
  }
  if (mode === "stack") {
    const { graphics, talent } = stackFractions(layout);
    const pct = (n: number) => {
      const value = n * 100;
      return Number.isInteger(value) ? `${value}%` : `${Number(value.toFixed(4))}%`;
    };
    return {
      sourceWrap: `position:"relative",width:"100%",height:"${pct(talent)}",flexShrink:0,overflow:"hidden"`,
      overlayWrap: `position:"relative",width:"100%",height:"${pct(graphics)}",flexShrink:0,overflow:"hidden"`,
      divider: "",
      sourceImg: layout?.crop ? cropSourceImgStyle(layout.crop) : `width:"100%",height:"100%",objectFit:"cover"`,
    };
  }
  if (mode === "crop" && layout?.crop) {
    return {
      sourceWrap: `position:"absolute",inset:0`,
      overlayWrap: `position:"absolute",inset:0`,
      divider: "",
      sourceImg: cropSourceImgStyle(layout.crop),
    };
  }
  return {
    sourceWrap: `position:"absolute",inset:0`,
    overlayWrap: `position:"absolute",inset:0`,
    divider: "",
    sourceImg: `width:"100%",height:"100%",objectFit:"cover"`,
  };
}

function stackSeamDivider(input: { layout?: SessionLayout; height: number }): string {
  const color = input.layout?.palette?.divider;
  if (!color || (input.layout?.mode ?? "full") !== "stack") return "";
  const top = stackDividerTop(input.layout, input.height, STACK_DIVIDER_PX);
  return `      <div style={{ position: "absolute", left: 0, right: 0, top: ${top}, height: ${STACK_DIVIDER_PX}, background: ${JSON.stringify(color)}, zIndex: 4 }} />`;
}

function wordSpans(input: {
  words: SessionCaptionWord[];
  tSec: number;
  idle: string;
  active: string;
}): string {
  return input.words
    .map((word) => {
      const on = input.tSec >= word.startSec && input.tSec < word.endSec;
      const color = on ? input.active : input.idle;
      return `<span style={{ color: ${JSON.stringify(color)}, marginRight: 14 }}>${JSON.stringify(word.text)}</span>`;
    })
    .join("");
}

function captionInner(input: {
  cue: CaptionCue;
  tSec?: number;
  fps: number;
  idle: string;
  active: string;
  live: boolean;
}): string {
  const words = input.cue.words ?? [];
  if (words.length === 0) return JSON.stringify(input.cue.text);
  if (input.live) {
    const sourceStart = input.cue.sourceStartSec ?? 0;
    return `<CaptionLine words={${JSON.stringify(words)}} sourceStartSec={${sourceStart}} fps={${input.fps}} idle={${JSON.stringify(input.idle)}} active={${JSON.stringify(input.active)}} />`;
  }
  return wordSpans({
    words,
    tSec: input.tSec ?? 0,
    idle: input.idle,
    active: input.active,
  });
}

function captionBand(input: {
  layout?: SessionLayout;
  height: number;
  captions?: CaptionCue[];
  tSec?: number;
  fps?: number;
  live?: boolean;
}): string {
  const cues = input.captions ?? [];
  if (cues.length === 0) return "";
  const stack = (input.layout?.mode ?? "full") === "stack";
  const seam = stack ? stackFractions(input.layout).graphics : 0.5;
  const bandH = captionBandHeight(input.layout);
  const top = Math.max(0, Math.round(seam * input.height - bandH / 2));
  const bg = input.layout?.palette?.captionBand ?? "rgba(0,0,0,0.75)";
  const idle = input.layout?.palette?.caption ?? "#ffffff";
  const active = input.layout?.palette?.captionActive ?? idle;
  const fontSize = captionFontSize(input.layout);
  const fps = input.fps ?? 30;
  const items = cues
    .map((cue) => {
      const inner = captionInner({
        cue,
        tSec: input.tSec,
        fps,
        idle,
        active,
        live: Boolean(input.live),
      });
      const strip = `<div style={{ width: "100%", height: ${bandH}, display: "flex", alignItems: "center", justifyContent: "center", padding: "0 28px", background: ${JSON.stringify(bg)}, color: ${JSON.stringify(idle)}, fontSize: ${fontSize}, fontWeight: 700, textAlign: "center" }}>${inner}</div>`;
      if (cue.from != null && cue.duration != null) {
        return `        <Sequence from={${cue.from}} durationInFrames={${Math.max(1, cue.duration)}}>
          ${strip}
        </Sequence>`;
      }
      return `        ${strip}`;
    })
    .join("\n");
  return `      <div style={{ position: "absolute", left: 0, right: 0, top: ${top}, zIndex: 5 }}>
${items}
      </div>`;
}

function frameShell(input: {
  layout?: SessionLayout;
  source: string;
  layers: string;
  height: number;
  captions?: CaptionCue[];
  tSec?: number;
  fps?: number;
  live?: boolean;
}): string {
  const style = layoutStyle(input.layout);
  const mode = input.layout?.mode ?? "full";
  const band = captionBand({
    layout: input.layout,
    height: input.height,
    captions: input.captions,
    tSec: input.tSec,
    fps: input.fps,
    live: input.live,
  });
  const seam = stackSeamDivider({ layout: input.layout, height: input.height });
  if (mode === "split") {
    return `    <AbsoluteFill style={{ backgroundColor: "transparent", flexDirection: "row" }}>
      <div style={{ ${style.sourceWrap} }}>
        ${input.source}
      </div>
      ${style.divider}
      <div style={{ ${style.overlayWrap} }}>
${input.layers}
      </div>
${band}
    </AbsoluteFill>`;
  }
  if (mode === "stack") {
    const canvas = input.layout?.palette?.canvas ?? "#0a0a0a";
    return `    <AbsoluteFill style={{ backgroundColor: ${JSON.stringify(canvas)}, flexDirection: "column" }}>
      <div style={{ ${style.overlayWrap} }}>
${input.layers}
      </div>
      <div style={{ ${style.sourceWrap} }}>
        ${input.source}
      </div>
${seam}
${band}
    </AbsoluteFill>`;
  }
  return `    <AbsoluteFill style={{ backgroundColor: "transparent" }}>
      <div style={{ ${style.sourceWrap} }}>
        ${input.source}
      </div>
      <div style={{ ${style.overlayWrap} }}>
${input.layers}
      </div>
${band}
    </AbsoluteFill>`;
}

export function stillHostSource(input: {
  active: SessionComp[];
  width: number;
  height: number;
  fps: number;
  tSec: number;
  sequences?: CompSequence[];
  layout?: SessionLayout;
  captions?: CaptionCue[];
}): string {
  const imports = input.active
    .map((comp, index) => `import UserComp${index} from "../comps/${comp.id}";`)
    .join("\n");
  const layers = input.active
    .map((comp, index) => {
      const mapped = (input.sequences ?? []).filter((item) => item.id === comp.id);
      const fallback: CompSequence = {
        id: comp.id,
        from: 0,
        duration: 1,
        trimBefore: Math.max(0, Math.round((input.tSec - comp.window.startSec) * input.fps)),
        playbackRate: 1,
      };
      const items = mapped.length > 0 ? mapped : [fallback];
      return items
        .map((item) => {
          const trim =
            item.trimBefore > 0 ? ` trimBefore={${Math.round(item.trimBefore)}}` : "";
          return `        <Sequence from={0} durationInFrames={1}${trim}>
          <UserComp${index} {...(props.compProps?.["${comp.id}"] ?? {})} palette={props.palette} />
        </Sequence>`;
        })
        .join("\n");
    })
    .join("\n");
  const source = `<Img src={staticFile("frame.png")} style={{ ${layoutStyle(input.layout).sourceImg} }} />`;
  const body = frameShell({
    layout: input.layout,
    source,
    layers,
    height: input.height,
    captions: input.captions,
    tSec: input.tSec,
    fps: input.fps,
    live: false,
  });

  return `import React from "react";
import { AbsoluteFill, Composition, Img, Sequence, staticFile } from "remotion";

${imports}

export type StillHostProps = {
  palette?: Record<string, string>;
  compProps?: Record<string, Record<string, unknown>>;
};

export const StillHost: React.FC<StillHostProps> = (props) => {
  return (
${body}
  );
};

export const RemotionRoot: React.FC = () => {
  return (
    <Composition
      id="StillHost"
      component={StillHost}
      width={${input.width}}
      height={${input.height}}
      fps={${input.fps}}
      durationInFrames={1}
      defaultProps={{ palette: {}, compProps: {} }}
    />
  );
};
`;
}

export function videoHostSource(input: {
  active: SessionComp[];
  width: number;
  height: number;
  fps: number;
  durationInFrames: number;
  sourceStartSec: number;
  sequences?: CompSequence[];
  layout?: SessionLayout;
  captions?: CaptionCue[];
}): string {
  const imports = input.active
    .map((comp, index) => `import UserComp${index} from "../comps/${comp.id}";`)
    .join("\n");
  const layers = input.active
    .map((comp, index) => {
      const mapped = (input.sequences ?? []).filter((item) => item.id === comp.id);
      const fallbackStart = Math.max(comp.window.startSec, input.sourceStartSec);
      const fallback: CompSequence = {
        id: comp.id,
        from: Math.max(0, Math.round((fallbackStart - input.sourceStartSec) * input.fps)),
        duration: (() => {
          const overlapEnd = Math.min(
            input.sourceStartSec + input.durationInFrames / input.fps,
            comp.window.endSec,
          );
          return Math.max(1, Math.round((overlapEnd - fallbackStart) * input.fps));
        })(),
        trimBefore: Math.max(0, Math.round((fallbackStart - comp.window.startSec) * input.fps)),
        playbackRate: 1,
      };
      const items = mapped.length > 0 ? mapped : [fallback];
      return items
        .map((item) => {
          const trim =
            item.trimBefore > 0 ? ` trimBefore={${Math.round(item.trimBefore)}}` : "";
          const rate = item.playbackRate > 0 ? item.playbackRate : 1;
          return `        <Sequence from={${item.from}} durationInFrames={${Math.max(1, item.duration)}}${trim}>
          <SourceLock trimBefore={${Math.round(item.trimBefore)}} playbackRate={${rate}}>
            <UserComp${index} {...(props.compProps?.["${comp.id}"] ?? {})} palette={props.palette} />
          </SourceLock>
        </Sequence>`;
        })
        .join("\n");
    })
    .join("\n");
  const source = `<OffthreadVideo src={staticFile("source.mp4")} style={{ ${layoutStyle(input.layout).sourceImg} }} muted />`;
  const body = frameShell({
    layout: input.layout,
    source,
    layers,
    height: input.height,
    captions: input.captions,
    fps: input.fps,
    live: true,
  });

  return `import React from "react";
import { AbsoluteFill, Composition, Freeze, OffthreadVideo, Sequence, staticFile, useCurrentFrame } from "remotion";

${imports}

function CaptionLine(props: {
  words: Array<{ text: string; startSec: number; endSec: number }>;
  sourceStartSec: number;
  fps: number;
  idle: string;
  active: string;
}) {
  const frame = useCurrentFrame();
  const tSec = props.sourceStartSec + frame / props.fps;
  return (
    <>
      {props.words.map((word, index) => (
        <span
          key={index}
          style={{
            color: tSec >= word.startSec && tSec < word.endSec ? props.active : props.idle,
            marginRight: 14,
          }}
        >
          {word.text}
        </span>
      ))}
    </>
  );
}

function SourceLock(props: { trimBefore: number; playbackRate: number; children: React.ReactNode }) {
  const frame = useCurrentFrame();
  const rate = props.playbackRate > 0 ? props.playbackRate : 1;
  const locked = props.trimBefore + (frame - props.trimBefore) * rate;
  return <Freeze frame={locked}>{props.children}</Freeze>;
}

export type VideoHostProps = {
  palette?: Record<string, string>;
  compProps?: Record<string, Record<string, unknown>>;
};

export const VideoHost: React.FC<VideoHostProps> = (props) => {
  return (
${body}
  );
};

export const RemotionRoot: React.FC = () => {
  return (
    <Composition
      id="VideoHost"
      component={VideoHost}
      width={${input.width}}
      height={${input.height}}
      fps={${input.fps}}
      durationInFrames={${Math.max(1, input.durationInFrames)}}
      defaultProps={{ palette: {}, compProps: {} }}
    />
  );
};
`;
}

export async function writeRemotionHost(
  remotionDir: string,
  input: {
    active: SessionComp[];
    width: number;
    height: number;
    fps: number;
    tSec: number;
    sequences?: CompSequence[];
    layout?: SessionLayout;
    captions?: CaptionCue[];
  },
): Promise<void> {
  await mkdir(remotionDir, { recursive: true });
  await writeFile(path.join(remotionDir, "StillHost.tsx"), stillHostSource(input), "utf8");
  await writeFile(
    path.join(remotionDir, "index.ts"),
    `import { registerRoot } from "remotion";\nimport { RemotionRoot } from "./StillHost";\n\nregisterRoot(RemotionRoot);\n`,
    "utf8",
  );
}

export async function writeRemotionVideoHost(
  remotionDir: string,
  input: {
    active: SessionComp[];
    width: number;
    height: number;
    fps: number;
    durationInFrames: number;
    sourceStartSec: number;
    sequences?: CompSequence[];
    layout?: SessionLayout;
    captions?: CaptionCue[];
  },
): Promise<void> {
  await mkdir(remotionDir, { recursive: true });
  await writeFile(path.join(remotionDir, "VideoHost.tsx"), videoHostSource(input), "utf8");
  await writeFile(
    path.join(remotionDir, "video-index.ts"),
    `import { registerRoot } from "remotion";\nimport { RemotionRoot } from "./VideoHost";\n\nregisterRoot(RemotionRoot);\n`,
    "utf8",
  );
}

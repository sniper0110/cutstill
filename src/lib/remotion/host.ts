import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { SessionComp, SessionLayout } from "../tools/types.js";

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
  if (mode === "crop" && layout?.crop) {
    const crop = layout.crop;
    const frac = crop.width <= 1 && crop.height <= 1;
    const x = frac ? crop.x : crop.x;
    const y = frac ? crop.y : crop.y;
    const w = frac ? crop.width : crop.width;
    const h = frac ? crop.height : crop.height;
    const originX = frac ? `${(x / w) * 100}` : String(x);
    const originY = frac ? `${(y / h) * 100}` : String(y);
    const scale = frac ? 1 / w : 1;
    return {
      sourceWrap: `position:"absolute",inset:0`,
      overlayWrap: `position:"absolute",inset:0`,
      divider: "",
      sourceImg: `width:"100%",height:"100%",objectFit:"cover",transformOrigin:"${originX}% ${originY}%",transform:"scale(${scale})"`,
    };
  }
  return {
    sourceWrap: `position:"absolute",inset:0`,
    overlayWrap: `position:"absolute",inset:0`,
    divider: "",
    sourceImg: `width:"100%",height:"100%",objectFit:"cover"`,
  };
}

function frameShell(input: {
  layout?: SessionLayout;
  source: string;
  layers: string;
}): string {
  const style = layoutStyle(input.layout);
  const split = (input.layout?.mode ?? "full") === "split";
  if (split) {
    return `    <AbsoluteFill style={{ backgroundColor: "transparent", flexDirection: "row" }}>
      <div style={{ ${style.sourceWrap} }}>
        ${input.source}
      </div>
      ${style.divider}
      <div style={{ ${style.overlayWrap} }}>
${input.layers}
      </div>
    </AbsoluteFill>`;
  }
  return `    <AbsoluteFill style={{ backgroundColor: "transparent" }}>
      <div style={{ ${style.sourceWrap} }}>
        ${input.source}
      </div>
      <div style={{ ${style.overlayWrap} }}>
${input.layers}
      </div>
    </AbsoluteFill>`;
}

export function stillHostSource(input: {
  active: SessionComp[];
  width: number;
  height: number;
  fps: number;
  layout?: SessionLayout;
}): string {
  const imports = input.active
    .map((comp, index) => `import UserComp${index} from "../comps/${comp.id}";`)
    .join("\n");
  const layers = input.active
    .map((comp, index) => `        <UserComp${index} {...(props.compProps?.["${comp.id}"] ?? {})} palette={props.palette} />`)
    .join("\n");
  const source = `<Img src={staticFile("frame.png")} style={{ ${layoutStyle(input.layout).sourceImg} }} />`;
  const body = frameShell({ layout: input.layout, source, layers });

  return `import React from "react";
import { AbsoluteFill, Composition, Img, staticFile } from "remotion";

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
  sequences?: Array<{ id: string; from: number; duration: number }>;
  layout?: SessionLayout;
}): string {
  const imports = input.active
    .map((comp, index) => `import UserComp${index} from "../comps/${comp.id}";`)
    .join("\n");
  const layers = input.active
    .map((comp, index) => {
      const mapped = input.sequences?.find((item) => item.id === comp.id);
      const from = mapped
        ? mapped.from
        : Math.max(0, Math.round((comp.window.startSec - input.sourceStartSec) * input.fps));
      const duration = mapped
        ? Math.max(1, mapped.duration)
        : (() => {
            const overlapEnd = Math.min(
              input.sourceStartSec + input.durationInFrames / input.fps,
              comp.window.endSec,
            );
            return Math.max(
              1,
              Math.round((overlapEnd - Math.max(comp.window.startSec, input.sourceStartSec)) * input.fps),
            );
          })();
      return `        <Sequence from={${from}} durationInFrames={${duration}}>
          <UserComp${index} {...(props.compProps?.["${comp.id}"] ?? {})} palette={props.palette} />
        </Sequence>`;
    })
    .join("\n");
  const source = `<OffthreadVideo src={staticFile("source.mp4")} style={{ ${layoutStyle(input.layout).sourceImg} }} muted />`;
  const body = frameShell({ layout: input.layout, source, layers });

  return `import React from "react";
import { AbsoluteFill, Composition, OffthreadVideo, Sequence, staticFile } from "remotion";

${imports}

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
  input: { active: SessionComp[]; width: number; height: number; fps: number; layout?: SessionLayout },
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
    sequences?: Array<{ id: string; from: number; duration: number }>;
    layout?: SessionLayout;
  },
): Promise<void> {
  await mkdir(remotionDir, { recursive: true });
  await writeFile(path.join(remotionDir, "VideoHost.tsx"), videoHostSource(input), "utf8");
  await writeFile(
    path.join(remotionDir, "index.ts"),
    `import { registerRoot } from "remotion";\nimport { RemotionRoot } from "./VideoHost";\n\nregisterRoot(RemotionRoot);\n`,
    "utf8",
  );
}

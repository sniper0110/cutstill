import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { SessionComp } from "../tools/types.js";

export function stillHostSource(input: {
  active: SessionComp[];
  width: number;
  height: number;
  fps: number;
}): string {
  const imports = input.active
    .map((comp, index) => `import UserComp${index} from "../comps/${comp.id}";`)
    .join("\n");
  const layers = input.active
    .map((comp, index) => `      <UserComp${index} {...(props.compProps?.["${comp.id}"] ?? {})} palette={props.palette} />`)
    .join("\n");

  return `import React from "react";
import { AbsoluteFill, Composition, Img, staticFile } from "remotion";

${imports}

export type StillHostProps = {
  palette?: Record<string, string>;
  compProps?: Record<string, Record<string, unknown>>;
};

export const StillHost: React.FC<StillHostProps> = (props) => {
  return (
    <AbsoluteFill style={{ backgroundColor: "transparent" }}>
      <Img src={staticFile("frame.png")} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
${layers}
    </AbsoluteFill>
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
}): string {
  const imports = input.active
    .map((comp, index) => `import UserComp${index} from "../comps/${comp.id}";`)
    .join("\n");
  const layers = input.active
    .map((comp, index) => {
      const from = Math.max(0, Math.round((comp.window.startSec - input.sourceStartSec) * input.fps));
      const overlapEnd = Math.min(
        input.sourceStartSec + input.durationInFrames / input.fps,
        comp.window.endSec,
      );
      const duration = Math.max(1, Math.round((overlapEnd - Math.max(comp.window.startSec, input.sourceStartSec)) * input.fps));
      return `      <Sequence from={${from}} durationInFrames={${duration}}>
        <UserComp${index} {...(props.compProps?.["${comp.id}"] ?? {})} palette={props.palette} />
      </Sequence>`;
    })
    .join("\n");

  return `import React from "react";
import { AbsoluteFill, Composition, OffthreadVideo, Sequence, staticFile } from "remotion";

${imports}

export type VideoHostProps = {
  palette?: Record<string, string>;
  compProps?: Record<string, Record<string, unknown>>;
};

export const VideoHost: React.FC<VideoHostProps> = (props) => {
  return (
    <AbsoluteFill style={{ backgroundColor: "transparent" }}>
      <OffthreadVideo src={staticFile("source.mp4")} style={{ width: "100%", height: "100%", objectFit: "cover" }} muted />
${layers}
    </AbsoluteFill>
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
  input: { active: SessionComp[]; width: number; height: number; fps: number },
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

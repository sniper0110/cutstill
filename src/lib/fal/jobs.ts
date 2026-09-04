import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import type { FalJob } from "../tools/types.js";
import type { FalJobStatus } from "./client.js";

export interface FalJobRecord extends FalJob {
  sessionId?: string;
  outPath?: string;
}

function looseJobPath(sessionsRoot: string, jobId: string): string {
  return path.join(sessionsRoot, "_fal", `${jobId}.json`);
}

export async function writeLooseJob(sessionsRoot: string, job: FalJobRecord): Promise<void> {
  const file = looseJobPath(sessionsRoot, job.jobId);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(job, null, 2), "utf8");
}

export async function readLooseJob(sessionsRoot: string, jobId: string): Promise<FalJobRecord | null> {
  const file = looseJobPath(sessionsRoot, jobId);
  if (!existsSync(file)) return null;
  return JSON.parse(await readFile(file, "utf8")) as FalJobRecord;
}

export function upsertSessionJob(jobs: FalJob[] | undefined, next: FalJob): FalJob[] {
  const list = [...(jobs ?? [])];
  const index = list.findIndex((item) => item.jobId === next.jobId);
  if (index >= 0) list[index] = { ...list[index], ...next };
  else list.push(next);
  return list;
}

export function defaultFalVideoPath(input: {
  sessionFalDir?: string;
  sessionsRoot: string;
  jobId: string;
}): string {
  if (input.sessionFalDir) return path.join(input.sessionFalDir, `${input.jobId}.mp4`);
  return path.join(input.sessionsRoot, "_fal", `${input.jobId}.mp4`);
}

export function jobPayload(job: FalJobRecord): {
  jobId: string;
  status: FalJobStatus;
  path?: string;
  width?: number;
  height?: number;
  durationSec?: number;
  costUsd?: number;
} {
  return {
    jobId: job.jobId,
    status: job.status,
    path: job.path,
    width: job.width,
    height: job.height,
    durationSec: job.durationSec,
    costUsd: job.costUsd,
  };
}

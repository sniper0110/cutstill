import { readFalVendorCost } from "../cost/meter.js";
import { ToolError } from "../tools/errors.js";
import type { FalHttp, FalHttpRequest, FalHttpResponse } from "../tools/types.js";

export const FAL_QUEUE_ORIGIN = "https://queue.fal.run";

export type FalJobStatus = "queued" | "in_progress" | "completed" | "failed";

export function resolveFalKey(explicit?: string): string {
  const key = (explicit ?? process.env.FAL_KEY ?? "").trim();
  if (!key) {
    throw new ToolError("FAL_AUTH", "FAL_KEY is not set");
  }
  return key;
}

export function redactFalSecrets(text: string, key?: string): string {
  let out = text;
  const secret = (key ?? process.env.FAL_KEY ?? "").trim();
  if (secret) out = out.split(secret).join("[redacted]");
  return out.replace(/Key\s+\S+/gi, "Key [redacted]");
}

function authHeader(key: string): Record<string, string> {
  return { Authorization: `Key ${key}`, "Content-Type": "application/json" };
}

function mapHttpError(status: number, key: string, detail: string): never {
  const safe = redactFalSecrets(detail, key);
  if (status === 401 || status === 403) {
    throw new ToolError("FAL_AUTH", safe || "Fal rejected the API key");
  }
  throw new ToolError("TOOL_FAILED", safe || `Fal HTTP ${status}`);
}

export function mapFalStatus(raw: string | undefined): FalJobStatus {
  const value = (raw ?? "").toUpperCase();
  if (value === "COMPLETED") return "completed";
  if (value === "IN_PROGRESS") return "in_progress";
  if (value === "FAILED" || value === "ERROR") return "failed";
  return "queued";
}

export async function defaultFalHttp(req: FalHttpRequest): Promise<FalHttpResponse> {
  const res = await fetch(req.url, {
    method: req.method,
    headers: req.headers,
    body: req.body,
  });
  const contentType = res.headers.get("content-type") ?? "";
  if (contentType.includes("application/json") || contentType.includes("text/")) {
    return { status: res.status, json: await res.json().catch(() => undefined) };
  }
  return { status: res.status, bytes: Buffer.from(await res.arrayBuffer()) };
}

export async function falRequest(
  http: FalHttp,
  key: string,
  req: Omit<FalHttpRequest, "headers"> & { headers?: Record<string, string> },
): Promise<FalHttpResponse> {
  return http({
    method: req.method,
    url: req.url,
    body: req.body,
    headers: { ...authHeader(key), ...req.headers },
  });
}

export async function falSubmit(input: {
  http: FalHttp;
  key: string;
  modelId: string;
  payload: Record<string, unknown>;
}): Promise<string> {
  const res = await falRequest(input.http, input.key, {
    method: "POST",
    url: `${FAL_QUEUE_ORIGIN}/${input.modelId}`,
    body: JSON.stringify(input.payload),
  });
  if (res.status === 401 || res.status === 403) {
    mapHttpError(res.status, input.key, "Fal rejected the API key");
  }
  if (res.status >= 400) {
    const detail =
      res.json && typeof res.json === "object"
        ? JSON.stringify(res.json)
        : `Fal submit failed (${res.status})`;
    mapHttpError(res.status, input.key, detail);
  }
  const rec = res.json && typeof res.json === "object" ? (res.json as Record<string, unknown>) : {};
  const jobId = typeof rec.request_id === "string" ? rec.request_id : "";
  if (!jobId) throw new ToolError("TOOL_FAILED", "Fal submit did not return request_id");
  return jobId;
}

export async function falPoll(input: {
  http: FalHttp;
  key: string;
  modelId: string;
  jobId: string;
}): Promise<FalJobStatus> {
  const res = await falRequest(input.http, input.key, {
    method: "GET",
    url: `${FAL_QUEUE_ORIGIN}/${input.modelId}/requests/${input.jobId}/status`,
  });
  if (res.status === 401 || res.status === 403) {
    mapHttpError(res.status, input.key, "Fal rejected the API key");
  }
  if (res.status >= 400) {
    mapHttpError(res.status, input.key, `Fal status failed (${res.status})`);
  }
  const rec = res.json && typeof res.json === "object" ? (res.json as Record<string, unknown>) : {};
  return mapFalStatus(typeof rec.status === "string" ? rec.status : undefined);
}

export async function falResult(input: {
  http: FalHttp;
  key: string;
  modelId: string;
  jobId: string;
}): Promise<{ videoUrl: string; costUsd?: number }> {
  const res = await falRequest(input.http, input.key, {
    method: "GET",
    url: `${FAL_QUEUE_ORIGIN}/${input.modelId}/requests/${input.jobId}`,
  });
  if (res.status === 401 || res.status === 403) {
    mapHttpError(res.status, input.key, "Fal rejected the API key");
  }
  if (res.status >= 400) {
    mapHttpError(res.status, input.key, `Fal result failed (${res.status})`);
  }
  const rec = res.json && typeof res.json === "object" ? (res.json as Record<string, unknown>) : {};
  const video = rec.video && typeof rec.video === "object" ? (rec.video as Record<string, unknown>) : {};
  const videoUrl = typeof video.url === "string" ? video.url : "";
  if (!videoUrl) throw new ToolError("TOOL_FAILED", "Fal result did not include video.url");
  return { videoUrl, costUsd: readFalVendorCost(rec) };
}

export async function falDownload(input: {
  http: FalHttp;
  key: string;
  url: string;
}): Promise<Buffer> {
  const res = await falRequest(input.http, input.key, {
    method: "GET",
    url: input.url,
    headers: { Authorization: `Key ${input.key}` },
  });
  if (res.status === 401 || res.status === 403) {
    mapHttpError(res.status, input.key, "Fal rejected the API key");
  }
  if (res.status >= 400) {
    mapHttpError(res.status, input.key, `Fal download failed (${res.status})`);
  }
  if (res.bytes && res.bytes.length > 0) return res.bytes;
  throw new ToolError("TOOL_FAILED", "Fal download returned no bytes");
}

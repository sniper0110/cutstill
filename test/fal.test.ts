import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { getToolsCatalog, invokeTool, isV1ToolName } from "../src/lib/tools/index.js";
import { FAL_MODEL_IDS } from "../src/lib/fal/models.js";
import { createSession, ctxFor, tempSessionsRoot } from "./helpers.js";
import { ensureStandInMp4 } from "../scripts/generate-fixtures.js";

const T2V = "bytedance/seedance-2.5/text-to-video";
const I2V = "bytedance/seedance-2.5/image-to-video";

function mockFalHttp(input: {
  submitStatus?: number;
  submitBody?: unknown;
  pollStatus?: string;
  resultBody?: unknown;
  downloadBytes?: Buffer;
  authFail?: boolean;
}): NonNullable<import("../src/lib/tools/types.js").ToolsContext["falHttp"]> {
  return async (req) => {
    if (input.authFail || req.headers.Authorization === "Key ") {
      return { status: 401, json: { detail: "Unauthorized" } };
    }
    if (req.method === "POST" && req.url.includes("queue.fal.run")) {
      return {
        status: input.submitStatus ?? 200,
        json: input.submitBody ?? { request_id: "job-seed-1" },
      };
    }
    if (req.url.includes("/status")) {
      return { status: 200, json: { status: input.pollStatus ?? "IN_QUEUE" } };
    }
    if (req.url.includes("/requests/")) {
      return {
        status: 200,
        json: input.resultBody ?? {
          video: { url: "https://cdn.example.test/fal-out.mp4" },
        },
      };
    }
    if (req.url.includes("cdn.example.test")) {
      return { status: 200, bytes: input.downloadBytes };
    }
    return { status: 404, json: { detail: "not mocked" } };
  };
}

describe("fal catalog", () => {
  it("lists fal.models / fal.generate / fal.status on cutstill.tools.v1", () => {
    const catalog = getToolsCatalog();
    const names = catalog.tools.map((tool) => tool.name);
    expect(names).toContain("fal.models");
    expect(names).toContain("fal.generate");
    expect(names).toContain("fal.status");
    expect(isV1ToolName("fal.generate")).toBe(true);
    expect(names).not.toContain("fal.attach");
    const blob = JSON.stringify(catalog);
    expect(blob.toLowerCase()).not.toContain("pycad");
    expect(blob.toLowerCase()).not.toContain("dental");
    const generate = catalog.tools.find((tool) => tool.name === "fal.generate");
    expect(generate?.errors.some((err) => err.code === "FAL_AUTH")).toBe(true);
    expect(generate?.input.properties?.generate_audio?.description).toMatch(/false/i);
  });

  it("fal.models returns the wired Seedance ids", async () => {
    const listed = (await invokeTool("fal.models", {})) as { models: Array<{ id: string }> };
    const ids = listed.models.map((item) => item.id);
    expect(ids).toEqual([...FAL_MODEL_IDS]);
    expect(ids).toContain(T2V);
    expect(ids).toContain(I2V);
    expect(ids).toContain("bytedance/seedance-2.5/reference-to-video");
  });
});

describe("fal.generate + fal.status", () => {
  it("missing FAL_KEY is FAL_AUTH and does not print a key", async () => {
    const root = await tempSessionsRoot("cutstill-fal-nokey-");
    const { sessionId } = await createSession(root);
    const prev = process.env.FAL_KEY;
    delete process.env.FAL_KEY;
    try {
      await expect(
        invokeTool(
          "fal.generate",
          { sessionId, modelId: T2V, prompt: "a lantern over water" },
          ctxFor(root, { skipNetwork: true }),
        ),
      ).rejects.toMatchObject({
        code: "FAL_AUTH",
        message: expect.stringMatching(/FAL_KEY/i),
      });
    } finally {
      if (prev != null) process.env.FAL_KEY = prev;
    }
  });

  it("maps HTTP 401 to FAL_AUTH without leaking the key", async () => {
    const root = await tempSessionsRoot("cutstill-fal-401-");
    const { sessionId } = await createSession(root);
    const secret = "fal-secret-do-not-leak-9f3a";
    await expect(
      invokeTool(
        "fal.generate",
        { sessionId, modelId: T2V, prompt: "a lantern over water" },
        ctxFor(root, {
          skipNetwork: true,
          falKey: secret,
          falHttp: mockFalHttp({ authFail: true }),
        }),
      ),
    ).rejects.toMatchObject({ code: "FAL_AUTH" });
    try {
      await invokeTool(
        "fal.generate",
        { sessionId, modelId: T2V, prompt: "a lantern over water" },
        ctxFor(root, {
          skipNetwork: true,
          falKey: secret,
          falHttp: mockFalHttp({ authFail: true }),
        }),
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      expect(message).not.toContain(secret);
      expect(JSON.stringify(error)).not.toContain(secret);
    }
  });

  it("submits async and returns jobId while queued", async () => {
    const root = await tempSessionsRoot("cutstill-fal-queue-");
    const { sessionId } = await createSession(root);
    const result = (await invokeTool(
      "fal.generate",
      {
        sessionId,
        modelId: T2V,
        prompt: "upper-pane lantern, 9:16",
        resolution: "720p",
        duration: 6,
        aspect_ratio: "9:16",
        generate_audio: false,
      },
      ctxFor(root, {
        skipNetwork: true,
        falKey: "test-key",
        falHttp: mockFalHttp({ pollStatus: "IN_QUEUE" }),
      }),
    )) as { jobId: string; status: string; path?: string };
    expect(result.jobId).toBe("job-seed-1");
    expect(result.status).toBe("queued");
    expect(result.path).toBeUndefined();
  });

  it("status completed downloads under the session and records usage", async () => {
    const root = await tempSessionsRoot("cutstill-fal-done-");
    const { sessionId } = await createSession(root);
    const standin = await readFile(await ensureStandInMp4());
    const http = mockFalHttp({
      pollStatus: "COMPLETED",
      downloadBytes: standin,
    });
    const submitted = (await invokeTool(
      "fal.generate",
      { sessionId, modelId: T2V, prompt: "lantern", duration: 5, resolution: "480p" },
      ctxFor(root, { skipNetwork: true, falKey: "test-key", falHttp: http }),
    )) as { jobId: string };

    const done = (await invokeTool(
      "fal.status",
      { sessionId, jobId: submitted.jobId },
      ctxFor(root, { skipNetwork: true, falKey: "test-key", falHttp: http }),
    )) as {
      jobId: string;
      status: string;
      path: string;
      width: number;
      height: number;
      durationSec: number;
    };
    expect(done.status).toBe("completed");
    expect(done.path).toMatch(new RegExp(`${sessionId}/fal/`));
    expect(done.path.endsWith(".mp4")).toBe(true);
    expect(done.width).toBeGreaterThan(0);
    expect(done.height).toBeGreaterThan(0);
    expect(done.durationSec).toBeGreaterThan(0);
    const bytes = await readFile(done.path);
    expect(bytes.length).toBeGreaterThan(32);

    const snap = (await invokeTool("session.get", { sessionId }, ctxFor(root))) as {
      usage: Array<{ action: string; costUsd: number; metadata?: Record<string, unknown> }>;
    };
    const gen = snap.usage.find((item) => item.action === "fal.generate");
    expect(gen).toBeTruthy();
    expect(typeof gen?.costUsd).toBe("number");
    expect(gen?.metadata?.modelId).toBe(T2V);
    expect(gen?.metadata?.jobId).toBe(submitted.jobId);
  });

  it("image-to-video requires image_url", async () => {
    const root = await tempSessionsRoot("cutstill-fal-i2v-");
    const { sessionId } = await createSession(root);
    await expect(
      invokeTool(
        "fal.generate",
        { sessionId, modelId: I2V, prompt: "the still begins to move" },
        ctxFor(root, { skipNetwork: true, falKey: "test-key", falHttp: mockFalHttp({}) }),
      ),
    ).rejects.toMatchObject({
      code: "INVALID_INPUT",
      message: expect.stringMatching(/image_url/i),
    });
  });
});

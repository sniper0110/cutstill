import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { invokeTool } from "../src/lib/tools/index.js";
import { createSession, ctxFor, ensureStandInMp4, tempSessionsRoot, writeBrief } from "./helpers.js";

describe("session.create / session.get", () => {
  it("creates sessions/<id>/ with source pointer, empty comps, usage, and optional brief copy", async () => {
    const root = await tempSessionsRoot();
    const briefPath = await writeBrief(root, "do not invent graphics from this note");
    const sourcePath = await ensureStandInMp4();
    const created = (await invokeTool(
      "session.create",
      { sourcePath, briefPath },
      ctxFor(root),
    )) as {
      sessionId: string;
      sourcePath: string;
      briefCopy: string;
      comps: unknown[];
      usage: unknown[];
      paths: { root: string; comps: string; stills: string; usage: string };
    };

    expect(created.sessionId).toMatch(/[0-9a-f-]{36}/);
    expect(created.sourcePath).toBe(path.resolve(sourcePath));
    expect(created.briefCopy).toBe("do not invent graphics from this note");
    expect(created.comps).toEqual([]);
    expect(created.usage).toEqual([]);
    expect(created.paths.root).toBe(path.join(root, created.sessionId));
    expect(existsSync(created.paths.comps)).toBe(true);
    expect(existsSync(created.paths.stills)).toBe(true);
    expect(existsSync(created.paths.usage)).toBe(true);

    const got = (await invokeTool("session.get", { sessionId: created.sessionId }, ctxFor(root))) as {
      sessionId: string;
      comps: unknown[];
      briefCopy: string;
    };
    expect(got.sessionId).toBe(created.sessionId);
    expect(got.comps).toEqual([]);
    expect(got.briefCopy).toBe("do not invent graphics from this note");
    const stored = await readFile(path.join(created.paths.root, "brief.md"), "utf8");
    expect(stored).toBe("do not invent graphics from this note");
  });

  it("rejects a missing source", async () => {
    const root = await tempSessionsRoot();
    await expect(
      invokeTool("session.create", { sourcePath: path.join(root, "missing.mp4") }, ctxFor(root)),
    ).rejects.toMatchObject({ code: "MEDIA_NOT_FOUND" });
  });

  it("session.create helper uses the local stand-in", async () => {
    const root = await tempSessionsRoot();
    const created = await createSession(root);
    expect(existsSync(created.paths.root)).toBe(true);
  });
});

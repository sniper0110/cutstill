import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { assertSandboxSource } from "../src/lib/sandbox.js";
import { invokeTool } from "../src/lib/tools/index.js";
import { createSession, ctxFor, tempSessionsRoot } from "./helpers.js";

describe("composition sandbox", () => {
  it("rejects a composition that fetches a URL", async () => {
    const root = await tempSessionsRoot();
    const { sessionId } = await createSession(root);
    await expect(
      invokeTool(
        "comp.upsert",
        {
          sessionId,
          id: "net",
          engine: "remotion",
          source: `export default function Bad() { fetch("https://example.com"); return null; }`,
          window: { startSec: 0, endSec: 1 },
        },
        ctxFor(root),
      ),
    ).rejects.toMatchObject({ code: "SANDBOX_VIOLATION" });
    expect(() => assertSandboxSource(`import { useEffect } from "react"; useEffect(() => { fetch("https://x"); }, []);`)).toThrow(
      /fetch/,
    );
  });

  it("rejects a composition that writes outside the session", async () => {
    const root = await tempSessionsRoot();
    const { sessionId } = await createSession(root);
    const outside = "/tmp/cutstill-sandbox-should-not-exist.txt";
    await expect(
      invokeTool(
        "comp.upsert",
        {
          sessionId,
          id: "disk",
          engine: "remotion",
          source: `import { writeFileSync } from "fs";
export default function Bad() {
  writeFileSync(${JSON.stringify(outside)}, "nope");
  return null;
}`,
          window: { startSec: 0, endSec: 1 },
        },
        ctxFor(root),
      ),
    ).rejects.toMatchObject({ code: "SANDBOX_VIOLATION" });
    expect(existsSync(outside)).toBe(false);
  });

  it("rejects staticFile that escapes the session", () => {
    expect(() => assertSandboxSource(`export default function C() { return staticFile("../secret.png"); }`)).toThrow(
      /staticFile/,
    );
    expect(() => assertSandboxSource(`export default function C() { return staticFile("/etc/passwd"); }`)).toThrow(
      /staticFile/,
    );
    expect(() => assertSandboxSource(`export default function C() { return staticFile("https://cdn.example/x"); }`)).toThrow(
      /staticFile/,
    );
  });

  it("allows a local session staticFile literal", () => {
    expect(() =>
      assertSandboxSource(`import { staticFile } from "remotion"; export default function C() { return staticFile("frame.png"); }`),
    ).not.toThrow();
  });
});

#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { stdin as stdinStream } from "node:process";
import path from "node:path";
import {
  getToolsCatalog,
  invokeTool,
  isV1ToolName,
  listToolNames,
  runMcpStdio,
  toolErrorPayload,
} from "../lib/tools/index.js";

function loadEnvFile(filePath: string): void {
  let content = "";
  try {
    content = readFileSync(filePath, "utf8");
  } catch {
    return;
  }
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
    const index = trimmed.indexOf("=");
    const key = trimmed.slice(0, index).trim();
    let value = trimmed.slice(index + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (key && process.env[key] === undefined) process.env[key] = value;
  }
}

loadEnvFile(path.join(process.cwd(), ".env.local"));
loadEnvFile(path.join(process.cwd(), ".env"));

function printHelp(): void {
  const tools = listToolNames()
    .map((name) => `  ${name}`)
    .join("\n");
  console.log(`cutstill — tool surface (cutstill.tools.v1)

External agents own the brief and the cut. Author a Remotion composition,
render a cheap still, see the PNG, patch, repeat. Window is for motion;
publish is once. Cut / keep / speed / layout map source seconds onto fileSec.

Usage:
  npx tsx src/cli/cutstill.ts <tool> --json '{...}'
  npx tsx src/cli/cutstill.ts <tool> --json          # JSON on stdin
  npx tsx src/cli/cutstill.ts schema
  npx tsx src/cli/cutstill.ts mcp

Tools:
${tools}

session.create:
  npx tsx src/cli/cutstill.ts session.create --json '{"sourcePath":"./source.mp4"}'

timeline.layout (portrait shorts — 1080×1920, caller fractions, seam captions):
  npx tsx src/cli/cutstill.ts timeline.layout --json '{"sessionId":"<id>","mode":"stack","stack":{"graphics":0.5,"talent":0.5},"bandHeight":120,"captionFontSize":48,"captions":[{"text":"one two","startSec":0.3,"endSec":2.0,"words":[{"text":"one","startSec":0.3,"endSec":0.9},{"text":"two","startSec":0.9,"endSec":2.0}]}],"palette":{"captionBand":"#111111","caption":"#ffffff","captionActive":"#ffe566","divider":"#222222"}}'

render.still / render.window on that stack:
  npx tsx src/cli/cutstill.ts render.still --json '{"sessionId":"<id>","tSec":0.8}'
  npx tsx src/cli/cutstill.ts render.window --json '{"sessionId":"<id>","startSec":0.4,"endSec":1.5}'

fal (Seedance 2.5 — set FAL_KEY; never printed). generate_audio defaults false.
  npx tsx src/cli/cutstill.ts fal.models --json '{}'
  npx tsx src/cli/cutstill.ts fal.generate --json '{"sessionId":"<id>","modelId":"bytedance/seedance-2.5/text-to-video","prompt":"upper-pane lantern, 9:16","resolution":"720p","duration":6,"aspect_ratio":"9:16"}'
  npx tsx src/cli/cutstill.ts fal.status --json '{"sessionId":"<id>","jobId":"<jobId>"}'

schema:
  npx tsx src/cli/cutstill.ts schema

stdout is JSON. Exit 0 on success, exit 1 with { "error": { "code", "message" } }.
CLI --json writes stills and shorts to disk and prints path + metadata. It does not inline pixels.
MCP render.still and render.window return a PNG in-band so a calling model sees the frame.
`);
}

function takeArgs(argv: string[]): { command: string; flags: Record<string, string[]> } {
  const [command = "help", ...tokens] = argv;
  const flags: Record<string, string[]> = {};
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]!;
    if (token === "--help" || token === "-h") {
      flags.help = ["1"];
      continue;
    }
    if (token.startsWith("--")) {
      const key = token.slice(2);
      const value = tokens[index + 1] && !tokens[index + 1]!.startsWith("--") ? tokens[++index]! : "1";
      flags[key] ??= [];
      flags[key].push(value);
    }
  }
  return { command, flags };
}

async function readStdinJson(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of stdinStream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function readToolInput(flags: Record<string, string[]>): Promise<unknown> {
  const rawFlag = flags.json?.[0];
  if (rawFlag && rawFlag !== "1") {
    return JSON.parse(rawFlag);
  }
  if (rawFlag === "1" || !process.stdin.isTTY) {
    const raw = (await readStdinJson()).trim();
    if (raw) return JSON.parse(raw);
  }
  if (rawFlag === "1") return {};
  throw new Error("tool calls require --json (inline object or stdin)");
}

async function runToolCommand(name: string, flags: Record<string, string[]>): Promise<void> {
  try {
    const input = await readToolInput(flags);
    const result = await invokeTool(name, input);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (error) {
    process.stdout.write(`${JSON.stringify(toolErrorPayload(error))}\n`);
    process.exitCode = 1;
  }
}

async function main(): Promise<void> {
  const { command, flags } = takeArgs(process.argv.slice(2));
  if (command === "help" || command === "--help" || flags.help) {
    printHelp();
    return;
  }
  if (command === "schema") {
    process.stdout.write(`${JSON.stringify(getToolsCatalog(), null, 2)}\n`);
    return;
  }
  if (command === "mcp") {
    await runMcpStdio();
    return;
  }
  if (isV1ToolName(command)) {
    await runToolCommand(command, flags);
    return;
  }
  process.stdout.write(
    `${JSON.stringify({ error: { code: "UNKNOWN_TOOL", message: `Unknown command: ${command}` } })}\n`,
  );
  process.exitCode = 1;
}

main().catch((error) => {
  process.stdout.write(`${JSON.stringify(toolErrorPayload(error))}\n`);
  process.exit(1);
});

import { ToolError } from "./tools/errors.js";

const COMP_ID = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;

const NETWORK_PATTERNS: Array<{ re: RegExp; why: string }> = [
  { re: /\bfetch\s*\(/, why: "fetch() is blocked in composition code" },
  { re: /\bXMLHttpRequest\b/, why: "XMLHttpRequest is blocked in composition code" },
  { re: /\bWebSocket\b/, why: "WebSocket is blocked in composition code" },
  { re: /\baxios\b/, why: "HTTP clients are blocked in composition code" },
  { re: /\bnode:http\b/, why: "node:http is blocked in composition code" },
  { re: /\bnode:https\b/, why: "node:https is blocked in composition code" },
  { re: /\bnode:net\b/, why: "node:net is blocked in composition code" },
  { re: /\brequire\s*\(\s*['"]https?['"]/, why: "http require is blocked" },
  { re: /\brequire\s*\(\s*['"]node:https?['"]/, why: "node:http require is blocked" },
  { re: /from\s+['"]https?:/, why: "remote ESM imports are blocked" },
  { re: /import\s*\(\s*['"]https?:/, why: "dynamic remote imports are blocked" },
];

const WRITE_PATTERNS: Array<{ re: RegExp; why: string }> = [
  { re: /\bwriteFile(Sync)?\s*\(/, why: "filesystem writes are blocked in composition code" },
  { re: /\bcreateWriteStream\s*\(/, why: "filesystem writes are blocked in composition code" },
  { re: /\bnode:fs\b/, why: "node:fs is blocked in composition code" },
  { re: /\brequire\s*\(\s*['"]fs['"]/, why: "fs is blocked in composition code" },
  { re: /\brequire\s*\(\s*['"]node:fs['"]/, why: "node:fs is blocked in composition code" },
  { re: /\bDeno\.(write|create|remove|mkdir)/, why: "Deno filesystem writes are blocked" },
  { re: /\bchild_process\b/, why: "child_process is blocked in composition code" },
  { re: /\bnode:child_process\b/, why: "node:child_process is blocked in composition code" },
];

export function assertCompId(id: string): string {
  if (!COMP_ID.test(id)) {
    throw new ToolError("INVALID_INPUT", "id must match [A-Za-z][A-Za-z0-9_-]{0,63}");
  }
  return id;
}

function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

export function assertSandboxSource(source: string): void {
  const body = stripComments(source);
  for (const { re, why } of NETWORK_PATTERNS) {
    if (re.test(body)) {
      throw new ToolError("SANDBOX_VIOLATION", why);
    }
  }
  for (const { re, why } of WRITE_PATTERNS) {
    if (re.test(body)) {
      throw new ToolError("SANDBOX_VIOLATION", why);
    }
  }

  for (const match of body.matchAll(/staticFile\s*\(\s*([^)]+)\)/g)) {
    const raw = match[1]?.trim() ?? "";
    const literal = raw.match(/^['"]([^'"]+)['"]$/);
    if (!literal) {
      throw new ToolError("SANDBOX_VIOLATION", "staticFile() must use a string literal");
    }
    const rel = literal[1]!;
    if (rel.includes("..") || rel.includes("://") || rel.startsWith("/") || rel.startsWith("\\")) {
      throw new ToolError("SANDBOX_VIOLATION", "staticFile() may only name files already in the session");
    }
  }
}

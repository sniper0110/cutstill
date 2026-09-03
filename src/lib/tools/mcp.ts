import { readFile } from "node:fs/promises";
import { getToolsCatalog } from "./catalog.js";
import { toolErrorPayload } from "./errors.js";
import { defaultToolsContext, invokeTool } from "./invoke.js";
import type { McpImageContent, McpTextContent, RenderStillResult, ToolsContext } from "./types.js";

interface JsonRpcRequest {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: Record<string, unknown>;
}

interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: string | number | null;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

function catalogAsMcpTools() {
  return getToolsCatalog().tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    inputSchema: tool.input,
    outputSchema: tool.output,
    errors: tool.errors,
  }));
}

function isRenderStillResult(value: unknown): value is RenderStillResult {
  return Boolean(value && typeof value === "object" && "path" in value && "tSec" in value && "compsActive" in value);
}

export async function mcpContentForResult(
  name: string,
  result: unknown,
): Promise<{
  content: Array<McpTextContent | McpImageContent>;
  structuredContent: unknown;
}> {
  if (name === "render.still" && isRenderStillResult(result)) {
    const bytes = await readFile(result.path);
    const imageBase64 = bytes.toString("base64");
    const image: McpImageContent = { type: "image", data: imageBase64, mimeType: "image/png" };
    return {
      content: [{ type: "text", text: JSON.stringify(result) }, image],
      structuredContent: { ...result, imageBase64, mimeType: "image/png" },
    };
  }
  return {
    content: [{ type: "text", text: JSON.stringify(result) }],
    structuredContent: result,
  };
}

export async function handleMcpRequest(
  request: JsonRpcRequest,
  ctx: ToolsContext = defaultToolsContext(),
): Promise<JsonRpcResponse | null> {
  const id = request.id ?? null;
  const method = request.method ?? "";
  if (method.startsWith("notifications/")) return null;

  try {
    if (method === "initialize") {
      return {
        jsonrpc: "2.0",
        id,
        result: {
          protocolVersion: "2024-11-05",
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: "cutstill.tools", version: "1" },
        },
      };
    }
    if (method === "ping") {
      return { jsonrpc: "2.0", id, result: {} };
    }
    if (method === "tools/list") {
      const catalog = getToolsCatalog();
      return {
        jsonrpc: "2.0",
        id,
        result: {
          schema: catalog.schema,
          tools: catalogAsMcpTools(),
        },
      };
    }
    if (method === "tools/call") {
      const params = request.params ?? {};
      const name = String(params.name ?? "");
      const args = params.arguments ?? {};
      const result = await invokeTool(name, args, ctx);
      const wrapped = await mcpContentForResult(name, result);
      return {
        jsonrpc: "2.0",
        id,
        result: wrapped,
      };
    }
    return {
      jsonrpc: "2.0",
      id,
      error: { code: -32601, message: `Method not found: ${method}` },
    };
  } catch (error) {
    const payload = toolErrorPayload(error);
    return {
      jsonrpc: "2.0",
      id,
      error: { code: -32000, message: payload.error.message, data: payload.error },
    };
  }
}

function parseContentLengthFrame(buffer: string): { message: JsonRpcRequest; rest: string } | null {
  const headerEnd = buffer.indexOf("\r\n\r\n");
  if (headerEnd < 0) return null;
  const header = buffer.slice(0, headerEnd);
  const match = header.match(/Content-Length:\s*(\d+)/i);
  if (!match) return null;
  const length = Number(match[1]);
  const bodyStart = headerEnd + 4;
  if (buffer.length < bodyStart + length) return null;
  const body = buffer.slice(bodyStart, bodyStart + length);
  return { message: JSON.parse(body) as JsonRpcRequest, rest: buffer.slice(bodyStart + length) };
}

export async function runMcpStdio(ctx: ToolsContext = defaultToolsContext()): Promise<void> {
  let buffer = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk: string) => {
    buffer += chunk;
    void drain();
  });

  let draining = false;
  async function drain(): Promise<void> {
    if (draining) return;
    draining = true;
    try {
      while (buffer.length > 0) {
        const framed = parseContentLengthFrame(buffer);
        if (framed) {
          buffer = framed.rest;
          const response = await handleMcpRequest(framed.message, ctx);
          if (response) writeFramed(response);
          continue;
        }
        const nl = buffer.indexOf("\n");
        if (nl < 0) break;
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (!line) continue;
        const response = await handleMcpRequest(JSON.parse(line) as JsonRpcRequest, ctx);
        if (response) {
          process.stdout.write(`${JSON.stringify(response)}\n`);
        }
      }
    } finally {
      draining = false;
    }
  }
}

function writeFramed(response: JsonRpcResponse): void {
  const body = JSON.stringify(response);
  process.stdout.write(`Content-Length: ${Buffer.byteLength(body, "utf8")}\r\n\r\n${body}`);
}

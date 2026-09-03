import { attachCallCost, sessionTotalUsd } from "../cost/meter.js";
import { isV1ToolName } from "./catalog.js";
import { ToolError } from "./errors.js";
import { HANDLERS } from "./handlers.js";
import { readSession, resolveSessionsRoot } from "./store.js";
import type { ToolsContext } from "./types.js";

export function defaultToolsContext(overrides: Partial<ToolsContext> = {}): ToolsContext {
  return {
    sessionsRoot: resolveSessionsRoot(overrides),
    skipNetwork: overrides.skipNetwork ?? process.env.CUTSTILL_SKIP_NETWORK !== "0",
    transcribe: overrides.transcribe,
    now: overrides.now,
    falHttp: overrides.falHttp,
    falKey: overrides.falKey,
    detectTalent: overrides.detectTalent,
  };
}

const FREE_LOOKUPS = new Set(["session.get", "session.cost", "session.create", "fal.models"]);

export async function invokeTool(
  name: string,
  input: unknown,
  ctx: ToolsContext = defaultToolsContext(),
): Promise<unknown> {
  if (!isV1ToolName(name)) {
    throw new ToolError("UNKNOWN_TOOL", `unknown tool: ${name}`);
  }
  const handler = HANDLERS[name];
  if (!handler) {
    throw new ToolError("UNKNOWN_TOOL", `no handler for ${name}`);
  }
  const result = await handler(input ?? {}, ctx);
  return attachResultCost(name, input, result, ctx);
}

async function attachResultCost(
  name: string,
  input: unknown,
  result: unknown,
  ctx: ToolsContext,
): Promise<unknown> {
  const rec = input && typeof input === "object" && !Array.isArray(input) ? (input as Record<string, unknown>) : {};
  const sessionId = typeof rec.sessionId === "string" ? rec.sessionId : undefined;
  let callCost = 0;
  let total = 0;
  if (sessionId) {
    try {
      const session = await readSession(resolveSessionsRoot(ctx), sessionId);
      total = sessionTotalUsd(session.usage);
      if (!FREE_LOOKUPS.has(name)) {
        const last = [...session.usage].reverse().find((item) => item.action === name);
        callCost = last?.costUsd ?? 0;
      }
    } catch {
      /* no session yet */
    }
  }
  return attachCallCost(result, { costUsd: callCost, sessionTotalUsd: total });
}

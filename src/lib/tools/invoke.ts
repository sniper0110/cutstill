import { isV1ToolName } from "./catalog.js";
import { ToolError } from "./errors.js";
import { HANDLERS } from "./handlers.js";
import { resolveSessionsRoot } from "./store.js";
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
  return handler(input ?? {}, ctx);
}

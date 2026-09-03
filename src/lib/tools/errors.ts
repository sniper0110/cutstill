export class ToolError extends Error {
  readonly code: string;
  readonly details?: Record<string, unknown>;

  constructor(code: string, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = "ToolError";
    this.code = code;
    this.details = details;
  }
}

export function toolErrorPayload(error: unknown): { error: { code: string; message: string } } {
  if (error instanceof ToolError) {
    return { error: { code: error.code, message: error.message } };
  }
  const message = error instanceof Error ? error.message : String(error);
  return { error: { code: "TOOL_FAILED", message } };
}

export function requireString(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new ToolError("INVALID_INPUT", `${field} is required`);
  }
  return value;
}

export function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

export function requireNumber(value: unknown, field: string): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) {
    throw new ToolError("INVALID_INPUT", `${field} must be a number`);
  }
  return n;
}

export function optionalNumber(value: unknown): number | undefined {
  if (value == null || value === "") return undefined;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : undefined;
}

export function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ToolError("INVALID_INPUT", "input must be a JSON object");
  }
  return value as Record<string, unknown>;
}

export function optionalRecord(value: unknown): Record<string, unknown> {
  if (value == null) return {};
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new ToolError("INVALID_INPUT", "props must be an object");
  }
  return value as Record<string, unknown>;
}

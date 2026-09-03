import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

export function hashBytes(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export async function hashFile(filePath: string): Promise<string> {
  return hashBytes(await readFile(filePath));
}

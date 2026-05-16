import { createHash, randomBytes } from "node:crypto";

export function hashRefreshToken(token: string, pepper: string): string {
  return createHash("sha256").update(token + pepper).digest("hex");
}

export function newRefreshToken(): string {
  return randomBytes(48).toString("base64url");
}

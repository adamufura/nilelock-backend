import jwt, { type SignOptions } from "jsonwebtoken";
import type { Types } from "mongoose";

export type AccessPayload = { sub: string; role: "admin" | "user"; typ: "access" };

export function signAccessToken(
  userId: Types.ObjectId,
  role: "admin" | "user",
  secret: string,
  expiresIn: string,
): string {
  const payload: AccessPayload = { sub: userId.toString(), role, typ: "access" };
  const options: SignOptions = { expiresIn: expiresIn as SignOptions["expiresIn"] };
  return jwt.sign(payload, secret, options);
}

export function verifyAccessToken(token: string, secret: string): AccessPayload {
  const decoded = jwt.verify(token, secret);
  if (typeof decoded !== "object" || decoded === null) throw new Error("Invalid token");
  const { sub, role, typ } = decoded as Record<string, unknown>;
  if (typ !== "access" || typeof sub !== "string" || (role !== "admin" && role !== "user")) {
    throw new Error("Invalid access token");
  }
  return { sub, role, typ: "access" };
}

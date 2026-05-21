import { z } from "zod";

export const PASSCODE_EXPIRY_PRESETS = [
  { id: "1m", label: "1 minute", ms: 60_000 },
  { id: "5m", label: "5 minutes", ms: 5 * 60_000 },
  { id: "30m", label: "30 minutes", ms: 30 * 60_000 },
  { id: "1h", label: "1 hour", ms: 60 * 60_000 },
  { id: "5h", label: "5 hours", ms: 5 * 60 * 60_000 },
  { id: "12h", label: "12 hours", ms: 12 * 60 * 60_000 },
  { id: "24h", label: "24 hours", ms: 24 * 60 * 60_000 },
] as const;

export type PasscodeExpiresIn = (typeof PASSCODE_EXPIRY_PRESETS)[number]["id"];

export const passcodeExpiresInSchema = z.enum(
  PASSCODE_EXPIRY_PRESETS.map((p) => p.id) as [PasscodeExpiresIn, ...PasscodeExpiresIn[]],
);

const presetMs = new Map(PASSCODE_EXPIRY_PRESETS.map((p) => [p.id, p.ms]));

export function expiresAtFromPreset(expiresIn: PasscodeExpiresIn, from = new Date()): Date {
  const ms = presetMs.get(expiresIn);
  if (ms === undefined) {
    throw new Error(`Unknown passcode expiry preset: ${expiresIn}`);
  }
  return new Date(from.getTime() + ms);
}

/** Legacy passcodes without expiresAt never expire. */
export function isPasscodeStillValid(expiresAt: Date | null | undefined, now = new Date()): boolean {
  if (expiresAt == null) return true;
  return expiresAt.getTime() > now.getTime();
}

/** Mongo filter: active passcodes that are not yet expired. */
export function activeNonExpiredPasscodeFilter(now = new Date()): Record<string, unknown> {
  return {
    active: true,
    $or: [{ expiresAt: { $exists: false } }, { expiresAt: null }, { expiresAt: { $gt: now } }],
  };
}

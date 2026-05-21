import type { Server as SocketIOServer } from "socket.io";
import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import { User } from "../models/User.js";
import { z } from "zod";
import { Lock } from "../models/Lock.js";
import { Passcode } from "../models/Passcode.js";
import { LockEvent } from "../models/LockEvent.js";
import { AppError } from "../lib/AppError.js";
import { randomInt } from "node:crypto";
import { findLockByRef } from "../lib/lockResolver.js";
import { isLockSlugPattern, normalizeLockSlug } from "../lib/lockSlug.js";
import { allocateUniqueSlugFromName } from "../lib/uniqueLockSlug.js";
import {
  activeNonExpiredPasscodeFilter,
  expiresAtFromPreset,
  isPasscodeStillValid,
  passcodeExpiresInSchema,
} from "../lib/passcodeExpiry.js";

const channelSchema = z.enum(["mobile", "dashboard", "simulator", "api"]);

export type ClientChannel = z.infer<typeof channelSchema>;

const commandSchema = z.object({
  action: z.enum(["lock", "unlock"]),
  passcode: z.string().min(4).max(16).optional(),
});

function parseChannel(header: unknown): ClientChannel {
  const raw = typeof header === "string" ? header.trim().toLowerCase() : "";
  const parsed = channelSchema.safeParse(raw || "api");
  return parsed.success ? parsed.data : "api";
}

export function getLockOwners(lock: { owners?: mongoose.Types.ObjectId[] }): mongoose.Types.ObjectId[] {
  const o = lock.owners;
  return Array.isArray(o) ? o : [];
}

export function canAccessLock(
  role: "admin" | "user",
  userId: mongoose.Types.ObjectId,
  owners: mongoose.Types.ObjectId[],
): boolean {
  if (role === "admin") return true;
  return owners.some((oid) => oid.equals(userId));
}

function emitToLockChannels(io: SocketIOServer, slug: string, event: string, payload: unknown): void {
  io.to(`lock:${slug}`).emit(event, payload);
  io.of("/public").to(`lock:${slug}`).emit(event, payload);
}

type PasscodeVerifyResult = "valid" | "expired" | "invalid";

async function verifyPasscodeForLock(
  lockObjId: mongoose.Types.ObjectId,
  code: string,
): Promise<PasscodeVerifyResult> {
  const active = await Passcode.find({ lock: lockObjId, active: true }).lean();
  let expiredMatch = false;
  for (const p of active) {
    if (!(await bcrypt.compare(code, p.hash))) continue;
    if (isPasscodeStillValid(p.expiresAt as Date | null | undefined)) return "valid";
    expiredMatch = true;
  }
  return expiredMatch ? "expired" : "invalid";
}

async function countActiveNonExpiredPasscodes(lockObjId: mongoose.Types.ObjectId): Promise<number> {
  return Passcode.countDocuments({ lock: lockObjId, ...activeNonExpiredPasscodeFilter() });
}

export async function runLockCommand(
  io: SocketIOServer,
  params: {
    lockRef: string;
    auth: { userId: mongoose.Types.ObjectId; role: "admin" | "user" };
    body: unknown;
    channelHeader: unknown;
  },
): Promise<{ lockId: string; state: "locked" | "unlocked" }> {
  const channel = parseChannel(params.channelHeader);
  const { action, passcode } = commandSchema.parse(params.body);

  const lock = await findLockByRef(params.lockRef);
  if (!lock) throw new AppError(404, "Lock not found");

  const owners = getLockOwners(lock);
  if (!canAccessLock(params.auth.role, params.auth.userId, owners)) {
    await LockEvent.create({
      lock: lock._id,
      user: params.auth.userId,
      action,
      outcome: "denied",
      channel,
      detail: "not_owner",
    });
    throw new AppError(403, "You do not have access to this lock");
  }

  if (action === "unlock" && channel === "simulator") {
    const activeCount = await countActiveNonExpiredPasscodes(lock._id);
    if (activeCount > 0) {
      if (!passcode) {
        await LockEvent.create({
          lock: lock._id,
          user: params.auth.userId,
          action,
          outcome: "denied",
          channel,
          detail: "passcode_required",
        });
        throw new AppError(400, "Passcode required for simulator unlock");
      }
      const verify = await verifyPasscodeForLock(lock._id, passcode);
      if (verify === "expired") {
        await LockEvent.create({
          lock: lock._id,
          user: params.auth.userId,
          action,
          outcome: "denied",
          channel,
          detail: "passcode_expired",
        });
        throw new AppError(403, "Passcode has expired");
      }
      if (verify !== "valid") {
        await LockEvent.create({
          lock: lock._id,
          user: params.auth.userId,
          action,
          outcome: "denied",
          channel,
          detail: "bad_passcode",
        });
        throw new AppError(403, "Invalid passcode");
      }
    }
  }

  const nextState = action === "lock" ? "locked" : "unlocked";
  lock.state = nextState;
  await lock.save();

  await LockEvent.create({
    lock: lock._id,
    user: params.auth.userId,
    action,
    outcome: "success",
    channel,
    detail: "",
  });

  const slug = lock.slug;
  const payload = {
    lockId: slug,
    state: lock.state as "locked" | "unlocked",
    updatedAt: lock.updatedAt?.toISOString() ?? new Date().toISOString(),
  };
  emitToLockChannels(io, slug, "lock:state", payload);

  return { lockId: slug, state: lock.state as "locked" | "unlocked" };
}

const publicUnlockSchema = z.object({
  passcode: z.string().min(4).max(16).optional(),
});

/** Campus simulator kiosk: unlock with visitor passcode (no login). */
export async function unlockLockFromSimulator(
  io: SocketIOServer,
  lockRef: string,
  body: unknown,
): Promise<{ lockId: string; state: "locked" | "unlocked" }> {
  const { passcode } = publicUnlockSchema.parse(body);
  const lock = await findLockByRef(lockRef);
  if (!lock) throw new AppError(404, "Lock not found");

  const owners = getLockOwners(lock);
  const eventUser = owners[0];
  if (!eventUser) throw new AppError(500, "Lock has no assigned owner");

  const channel: ClientChannel = "simulator";
  const action = "unlock" as const;

  if (lock.state === "unlocked") {
    return { lockId: lock.slug, state: "unlocked" };
  }

  const activeCount = await countActiveNonExpiredPasscodes(lock._id);
  if (activeCount > 0) {
    if (!passcode?.trim()) {
      await LockEvent.create({
        lock: lock._id,
        user: eventUser,
        action,
        outcome: "denied",
        channel,
        detail: "passcode_required",
      });
      throw new AppError(400, "Passcode required");
    }
    const verify = await verifyPasscodeForLock(lock._id, passcode.trim());
    if (verify === "expired") {
      await LockEvent.create({
        lock: lock._id,
        user: eventUser,
        action,
        outcome: "denied",
        channel,
        detail: "passcode_expired",
      });
      throw new AppError(403, "Passcode has expired");
    }
    if (verify !== "valid") {
      await LockEvent.create({
        lock: lock._id,
        user: eventUser,
        action,
        outcome: "denied",
        channel,
        detail: "bad_passcode",
      });
      throw new AppError(403, "Invalid passcode");
    }
  }

  lock.state = "unlocked";
  await lock.save();

  await LockEvent.create({
    lock: lock._id,
    user: eventUser,
    action,
    outcome: "success",
    channel,
    detail: "public_kiosk",
  });

  const slug = lock.slug;
  const payload = {
    lockId: slug,
    state: lock.state as "locked" | "unlocked",
    updatedAt: lock.updatedAt?.toISOString() ?? new Date().toISOString(),
  };
  emitToLockChannels(io, slug, "lock:state", payload);

  return { lockId: slug, state: "unlocked" };
}

const createLockSchema = z.object({
  name: z.string().min(1).max(120).trim(),
  location: z.string().max(200).trim().optional(),
  ownerIds: z.array(z.string().length(24)).min(1, "At least one owner required"),
  slug: z
    .string()
    .trim()
    .optional()
    .transform((s) => (s ? normalizeLockSlug(s) : undefined)),
});

export async function createLock(
  body: unknown,
  _adminUserId: mongoose.Types.ObjectId,
): Promise<{
  id: string;
  slug: string;
  name: string;
  location: string;
  ownerIds: string[];
  state: string;
  batteryLevel: number;
}> {
  const data = createLockSchema.parse(body);

  const ownerIds = [...new Set(data.ownerIds)];
  for (const oid of ownerIds) {
    if (!mongoose.isValidObjectId(oid)) throw new AppError(400, "Invalid owner id");
    const exists = await User.exists({ _id: oid });
    if (!exists) throw new AppError(400, "Owner user not found");
  }

  let slug = data.slug;
  if (slug) {
    if (!isLockSlugPattern(slug)) {
      throw new AppError(400, "Slug must be lowercase letters, numbers, and hyphens only");
    }
    if (await Lock.exists({ slug })) throw new AppError(409, "That slug is already in use");
  } else {
    slug = await allocateUniqueSlugFromName(data.name);
  }

  const lock = await Lock.create({
    slug,
    name: data.name,
    location: data.location ?? "",
    owners: ownerIds.map((id) => new mongoose.Types.ObjectId(id)),
    state: "locked",
  });

  return {
    id: lock.slug,
    slug: lock.slug,
    name: lock.name,
    location: lock.location ?? "",
    ownerIds: ownerIds,
    state: lock.state,
    batteryLevel: lock.batteryLevel,
  };
}

const updateLockSchema = z.object({
  name: z.string().min(1).max(120).trim().optional(),
  location: z.string().max(200).trim().optional(),
  ownerIds: z.array(z.string().length(24)).min(1).optional(),
  slug: z
    .string()
    .trim()
    .optional()
    .transform((s) => (s ? normalizeLockSlug(s) : undefined)),
});

export async function updateLock(lockRef: string, body: unknown): Promise<{
  id: string;
  slug: string;
  name: string;
  location: string;
  ownerIds: string[];
  state: string;
  batteryLevel: number;
}> {
  const data = updateLockSchema.parse(body);
  const lock = await findLockByRef(lockRef);
  if (!lock) throw new AppError(404, "Lock not found");

  if (data.name !== undefined) lock.name = data.name;
  if (data.location !== undefined) lock.location = data.location;

  if (data.ownerIds !== undefined) {
    const ownerIds = [...new Set(data.ownerIds)];
    for (const oid of ownerIds) {
      if (!mongoose.isValidObjectId(oid)) throw new AppError(400, "Invalid owner id");
      const exists = await User.exists({ _id: oid });
      if (!exists) throw new AppError(400, "Owner user not found");
    }
    lock.set(
      "owners",
      ownerIds.map((id) => new mongoose.Types.ObjectId(id)),
    );
  }

  if (data.slug !== undefined) {
    if (!isLockSlugPattern(data.slug)) {
      throw new AppError(400, "Invalid slug format");
    }
    const taken = await Lock.exists({ slug: data.slug, _id: { $ne: lock._id } });
    if (taken) throw new AppError(409, "That slug is already in use");
    lock.slug = data.slug;
  }

  await lock.save();

  const owners = getLockOwners(lock);
  return {
    id: lock.slug,
    slug: lock.slug,
    name: lock.name,
    location: lock.location ?? "",
    ownerIds: owners.map((o) => o.toString()),
    state: lock.state,
    batteryLevel: lock.batteryLevel,
  };
}

const passcodeBodySchema = z.object({
  code: z.string().regex(/^\d{4,10}$/, "Passcode must be 4–10 digits"),
});

const verifyPasscodeBodySchema = z.object({
  code: z.string().regex(/^\d{4}$/, "Enter 4 digits"),
});

export async function verifyPasscodeOnly(
  lockRef: string,
  body: unknown,
  auth: { userId: mongoose.Types.ObjectId; role: "admin" | "user" },
): Promise<{ valid: boolean; expired?: boolean }> {
  const { code } = verifyPasscodeBodySchema.parse(body);

  const lock = await findLockByRef(lockRef);
  if (!lock) throw new AppError(404, "Lock not found");
  const owners = getLockOwners(lock);
  if (!canAccessLock(auth.role, auth.userId, owners)) {
    throw new AppError(403, "You do not have access to this lock");
  }

  const verify = await verifyPasscodeForLock(lock._id, code);
  return { valid: verify === "valid", expired: verify === "expired" };
}

export async function getPasscodeMeta(
  lockRef: string,
  auth: { userId: mongoose.Types.ObjectId; role: "admin" | "user" },
): Promise<{
  hasPasscode: boolean;
  expiresAt?: string;
  expiresIn?: string;
  expired?: boolean;
}> {
  const lock = await findLockByRef(lockRef);
  if (!lock) throw new AppError(404, "Lock not found");
  const owners = getLockOwners(lock);
  if (!canAccessLock(auth.role, auth.userId, owners)) {
    throw new AppError(403, "You do not have access to this lock");
  }
  const doc = await Passcode.findOne({
    lock: lock._id,
    forUser: auth.userId,
    active: true,
  })
    .select("expiresAt _id")
    .lean();

  if (!doc) {
    return { hasPasscode: false };
  }

  const expiresAt = doc.expiresAt as Date | null | undefined;
  if (!isPasscodeStillValid(expiresAt)) {
    await Passcode.updateOne({ _id: doc._id }, { $set: { active: false } });
    return {
      hasPasscode: false,
      expired: true,
      expiresAt: expiresAt?.toISOString(),
    };
  }

  return {
    hasPasscode: true,
    expiresAt: expiresAt?.toISOString(),
  };
}

const generatePasscodeBodySchema = z.object({
  expiresIn: passcodeExpiresInSchema,
});

export async function generateRandomPasscode(
  lockRef: string,
  body: unknown,
  auth: { userId: mongoose.Types.ObjectId; role: "admin" | "user" },
): Promise<{ code: string; expiresAt: string; expiresIn: string }> {
  const { expiresIn } = generatePasscodeBodySchema.parse(body);

  const lock = await findLockByRef(lockRef);
  if (!lock) throw new AppError(404, "Lock not found");
  const owners = getLockOwners(lock);
  if (!canAccessLock(auth.role, auth.userId, owners)) {
    throw new AppError(403, "You do not have access to this lock");
  }

  const expiresAt = expiresAtFromPreset(expiresIn);
  const code = Array.from({ length: 4 }, () => randomInt(0, 10)).join("");
  await Passcode.updateMany(
    { lock: lock._id, forUser: auth.userId },
    { $set: { active: false } },
  );
  const hash = await bcrypt.hash(code, 12);
  await Passcode.create({
    lock: lock._id,
    forUser: auth.userId,
    hash,
    active: true,
    expiresAt,
    createdBy: auth.userId,
  });
  return { code, expiresAt: expiresAt.toISOString(), expiresIn };
}

const setPasscodeBodySchema = passcodeBodySchema.extend({
  expiresIn: passcodeExpiresInSchema,
});

export async function setLockPasscode(
  lockRef: string,
  body: unknown,
  auth: { userId: mongoose.Types.ObjectId; role: "admin" | "user" },
): Promise<{ ok: true; expiresAt: string; expiresIn: string }> {
  const { code, expiresIn } = setPasscodeBodySchema.parse(body);

  const lock = await findLockByRef(lockRef);
  if (!lock) throw new AppError(404, "Lock not found");
  const owners = getLockOwners(lock);
  if (!canAccessLock(auth.role, auth.userId, owners)) {
    throw new AppError(403, "You do not have access to this lock");
  }

  const expiresAt = expiresAtFromPreset(expiresIn);
  await Passcode.updateMany(
    { lock: lock._id, forUser: auth.userId },
    { $set: { active: false } },
  );
  const hash = await bcrypt.hash(code, 12);
  await Passcode.create({
    lock: lock._id,
    forUser: auth.userId,
    hash,
    active: true,
    expiresAt,
    createdBy: auth.userId,
  });

  return { ok: true, expiresAt: expiresAt.toISOString(), expiresIn };
}

export async function deleteLock(io: SocketIOServer, lockRef: string): Promise<void> {
  const lock = await findLockByRef(lockRef);
  if (!lock) throw new AppError(404, "Lock not found");

  const slug = lock.slug;
  const delPayload = { lockId: slug };
  emitToLockChannels(io, slug, "lock:deleted", delPayload);

  await Passcode.deleteMany({ lock: lock._id });
  await LockEvent.deleteMany({ lock: lock._id });
  await Lock.deleteOne({ _id: lock._id });
}

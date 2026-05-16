import { Router } from "express";
import type { Server as SocketIOServer } from "socket.io";
import mongoose from "mongoose";
import { asyncHandler } from "../lib/asyncHandler.js";
import { AppError } from "../lib/AppError.js";
import { Lock } from "../models/Lock.js";
import { findLockByRef } from "../lib/lockResolver.js";
import {
  createLock,
  updateLock,
  runLockCommand,
  setLockPasscode,
  deleteLock,
  verifyPasscodeOnly,
  getPasscodeMeta,
  generateRandomPasscode,
  canAccessLock,
  getLockOwners,
} from "../services/lockService.js";
import { requireAdmin } from "../middleware/auth.js";

function paramId(value: string | string[] | undefined): string {
  if (value === undefined) return "";
  return Array.isArray(value) ? (value[0] ?? "") : value;
}

type LockLeanDoc = {
  _id: mongoose.Types.ObjectId;
  slug: string;
  name: string;
  location?: string;
  owners: mongoose.Types.ObjectId[];
  state: string;
  batteryLevel: number;
  updatedAt?: Date;
};

function serializeLock(lock: LockLeanDoc) {
  const owners = Array.isArray(lock.owners) ? lock.owners : [];
  return {
    id: lock.slug,
    slug: lock.slug,
    name: lock.name,
    location: lock.location ?? "",
    ownerIds: owners.map((o) => o.toString()),
    state: lock.state,
    batteryLevel: lock.batteryLevel,
    updatedAt: lock.updatedAt,
  };
}

export function createLocksRouter(io: SocketIOServer): Router {
  const router = Router();

  router.get(
    "/",
    asyncHandler(async (req, res) => {
      const filter =
        req.auth!.role === "admin" ? {} : { owners: req.auth!.userId };
      const locks = await Lock.find(filter).sort({ updatedAt: -1 }).lean();
      res.json({
        locks: locks.map((l) => serializeLock(l as LockLeanDoc)),
      });
    }),
  );

  router.post(
    "/",
    requireAdmin,
    asyncHandler(async (req, res) => {
      const created = await createLock(req.body, req.auth!.userId);
      res.status(201).json({ lock: created });
    }),
  );

  router.patch(
    "/:lockRef",
    requireAdmin,
    asyncHandler(async (req, res) => {
      const lockRef = paramId(req.params.lockRef);
      if (!lockRef.trim()) {
        throw new AppError(400, "Lock identifier required");
      }
      const updated = await updateLock(lockRef, req.body);
      res.json({ lock: updated });
    }),
  );

  router.delete(
    "/:lockRef",
    requireAdmin,
    asyncHandler(async (req, res) => {
      const lockRef = paramId(req.params.lockRef);
      if (!lockRef.trim()) {
        throw new AppError(400, "Lock identifier required");
      }
      await deleteLock(io, lockRef);
      res.status(204).send();
    }),
  );

  router.get(
    "/:lockRef/passcode",
    asyncHandler(async (req, res) => {
      const lockRef = paramId(req.params.lockRef);
      if (!lockRef.trim()) {
        throw new AppError(400, "Lock identifier required");
      }
      const meta = await getPasscodeMeta(lockRef, req.auth!);
      res.json(meta);
    }),
  );

  router.post(
    "/:lockRef/passcode/generate",
    asyncHandler(async (req, res) => {
      const lockRef = paramId(req.params.lockRef);
      if (!lockRef.trim()) {
        throw new AppError(400, "Lock identifier required");
      }
      const { code } = await generateRandomPasscode(lockRef, req.auth!);
      res.status(201).json({ code });
    }),
  );

  router.get(
    "/:lockRef",
    asyncHandler(async (req, res) => {
      const lockRef = paramId(req.params.lockRef);
      if (!lockRef.trim()) {
        throw new AppError(400, "Lock identifier required");
      }
      const lock = await findLockByRef(lockRef);
      if (!lock) throw new AppError(404, "Lock not found");
      const owners = getLockOwners(lock);
      if (!canAccessLock(req.auth!.role, req.auth!.userId, owners)) {
        throw new AppError(403, "You do not have access to this lock");
      }
      res.json({
        lock: serializeLock(lock.toObject() as LockLeanDoc),
      });
    }),
  );

  router.post(
    "/:lockRef/command",
    asyncHandler(async (req, res) => {
      const lockRef = paramId(req.params.lockRef);
      if (!lockRef.trim()) {
        throw new AppError(400, "Lock identifier required");
      }
      const result = await runLockCommand(io, {
        lockRef,
        auth: req.auth!,
        body: req.body,
        channelHeader: paramId(req.headers["x-client-channel"]) || undefined,
      });
      res.json(result);
    }),
  );

  router.post(
    "/:lockRef/passcode/verify",
    asyncHandler(async (req, res) => {
      const lockRef = paramId(req.params.lockRef);
      if (!lockRef.trim()) {
        throw new AppError(400, "Lock identifier required");
      }
      const result = await verifyPasscodeOnly(lockRef, req.body, req.auth!);
      res.json(result);
    }),
  );

  router.post(
    "/:lockRef/passcode",
    asyncHandler(async (req, res) => {
      const lockRef = paramId(req.params.lockRef);
      if (!lockRef.trim()) {
        throw new AppError(400, "Lock identifier required");
      }
      const result = await setLockPasscode(lockRef, req.body, req.auth!);
      res.json(result);
    }),
  );

  return router;
}

import { Router } from "express";
import mongoose from "mongoose";
import { asyncHandler } from "../lib/asyncHandler.js";
import { LockEvent } from "../models/LockEvent.js";
import { Lock } from "../models/Lock.js";

type PopulatedLock = { _id: mongoose.Types.ObjectId; slug?: string; name?: string };
type PopulatedUser = { _id: mongoose.Types.ObjectId; email?: string; fullName?: string };

function eventLockId(lock: unknown): string {
  const L = lock as PopulatedLock | null;
  if (!L) return "";
  if (L.slug) return L.slug;
  return L._id?.toString() ?? "";
}

function serializeEvent(e: {
  _id: mongoose.Types.ObjectId;
  lock: unknown;
  user: unknown;
  action: string;
  outcome: string;
  channel: string;
  detail?: string;
  createdAt?: Date;
}) {
  const lock = e.lock as PopulatedLock | null;
  const user = e.user as PopulatedUser | null;
  return {
    id: e._id.toString(),
    lockId: eventLockId(lock),
    lockName: lock?.name ?? "",
    userId: user?._id?.toString() ?? "",
    userEmail: user?.email ?? "",
    userFullName: user?.fullName ?? "",
    action: e.action,
    outcome: e.outcome,
    channel: e.channel,
    detail: e.detail ?? "",
    createdAt: e.createdAt,
  };
}

export function createEventsRouter(): Router {
  const router = Router();

  router.get(
    "/my",
    asyncHandler(async (req, res) => {
      const limit = Math.min(Number(req.query.limit) || 50, 200);
      const locks = await Lock.find({ owners: req.auth!.userId }).select("_id").lean();
      const ids = locks.map((l) => l._id);
      const filter: Record<string, unknown> = { lock: { $in: ids } };

      const events = await LockEvent.find(filter)
        .sort({ createdAt: -1 })
        .limit(limit)
        .populate("user", "email fullName")
        .populate("lock", "name slug")
        .lean();

      res.json({
        events: events.map(serializeEvent),
      });
    }),
  );

  router.get(
    "/",
    asyncHandler(async (req, res) => {
      const limit = Math.min(Number(req.query.limit) || 50, 200);
      const filter: Record<string, unknown> = {};

      if (req.auth!.role !== "admin") {
        const locks = await Lock.find({ owners: req.auth!.userId }).select("_id").lean();
        const ids = locks.map((l) => l._id);
        filter.lock = { $in: ids };
      }

      const events = await LockEvent.find(filter)
        .sort({ createdAt: -1 })
        .limit(limit)
        .populate("user", "email fullName")
        .populate("lock", "name slug")
        .lean();

      res.json({
        events: events.map(serializeEvent),
      });
    }),
  );

  return router;
}

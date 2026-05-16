import { Router } from "express";
import mongoose from "mongoose";
import { asyncHandler } from "../lib/asyncHandler.js";
import { LockEvent } from "../models/LockEvent.js";
import { Lock } from "../models/Lock.js";

type PopulatedLock = { _id: mongoose.Types.ObjectId; slug?: string; name?: string };

function eventLockId(lock: unknown): string {
  const L = lock as PopulatedLock;
  if (L?.slug) return L.slug;
  return L?._id?.toString() ?? "";
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
        events: events.map((e) => ({
          id: e._id.toString(),
          lockId: eventLockId(e.lock),
          lockName: (e.lock as PopulatedLock).name ?? "",
          userId: (e.user as { _id: mongoose.Types.ObjectId })._id.toString(),
          userEmail: (e.user as { email?: string }).email ?? "",
          action: e.action,
          outcome: e.outcome,
          channel: e.channel,
          detail: e.detail,
          createdAt: e.createdAt,
        })),
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
        events: events.map((e) => ({
          id: e._id.toString(),
          lockId: eventLockId(e.lock),
          lockName: (e.lock as PopulatedLock).name ?? "",
          userId: (e.user as { _id: mongoose.Types.ObjectId })._id.toString(),
          userEmail: (e.user as { email?: string }).email ?? "",
          action: e.action,
          outcome: e.outcome,
          channel: e.channel,
          detail: e.detail,
          createdAt: e.createdAt,
        })),
      });
    }),
  );

  return router;
}

import { Router } from "express";
import mongoose from "mongoose";
import { asyncHandler } from "../lib/asyncHandler.js";
import { AppError } from "../lib/AppError.js";
import { Lock } from "../models/Lock.js";
import { User } from "../models/User.js";
import { findLockByRef } from "../lib/lockResolver.js";

function paramId(value: string | string[] | undefined): string {
  if (value === undefined) return "";
  return Array.isArray(value) ? (value[0] ?? "") : value;
}

export function createPublicRouter(): Router {
  const router = Router();

  router.get(
    "/locks",
    asyncHandler(async (_req, res) => {
      const locks = await Lock.find({}).sort({ name: 1 }).lean();
      res.json({
        locks: locks.map((l) => ({
          slug: l.slug,
          name: l.name,
          location: l.location ?? "",
          state: l.state,
          batteryLevel: l.batteryLevel,
          updatedAt: l.updatedAt,
        })),
      });
    }),
  );

  router.get(
    "/locks/:slug",
    asyncHandler(async (req, res) => {
      const slug = paramId(req.params.slug);
      if (!slug.trim()) throw new AppError(400, "Slug required");
      const lock = await findLockByRef(slug);
      if (!lock) throw new AppError(404, "Lock not found");

      const owners = await User.find({
        _id: { $in: lock.owners as mongoose.Types.ObjectId[] },
      })
        .select("email fullName")
        .lean();

      res.json({
        lock: {
          slug: lock.slug,
          name: lock.name,
          location: lock.location ?? "",
          state: lock.state,
          batteryLevel: lock.batteryLevel,
          updatedAt: lock.updatedAt,
          owners: owners.map((u) => ({
            id: u._id.toString(),
            fullName: u.fullName,
            email: u.email,
          })),
        },
      });
    }),
  );

  return router;
}

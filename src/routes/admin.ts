import { Router } from "express";
import mongoose from "mongoose";
import { z } from "zod";
import { asyncHandler } from "../lib/asyncHandler.js";
import { AppError } from "../lib/AppError.js";
import { User } from "../models/User.js";
import { adminCreateUser, adminDeleteUser } from "../services/adminUserService.js";

function paramId(value: string | string[] | undefined): string {
  if (value === undefined) return "";
  return Array.isArray(value) ? (value[0] ?? "") : value;
}

const roleBodySchema = z.object({
  role: z.enum(["admin", "user"]),
});

export function createAdminRouter(): Router {
  const router = Router();

  router.get(
    "/users",
    asyncHandler(async (_req, res) => {
      const users = await User.find().sort({ createdAt: -1 }).select("email fullName role createdAt").lean();
      res.json({
        users: users.map((u) => ({
          id: u._id.toString(),
          email: u.email,
          fullName: u.fullName,
          role: u.role,
          createdAt: u.createdAt,
        })),
      });
    }),
  );

  router.post(
    "/users",
    asyncHandler(async (req, res) => {
      const user = await adminCreateUser(req.body);
      res.status(201).json({ user });
    }),
  );

  router.delete(
    "/users/:userId",
    asyncHandler(async (req, res) => {
      await adminDeleteUser(req.auth!.userId, paramId(req.params.userId));
      res.status(204).send();
    }),
  );

  router.patch(
    "/users/:userId/role",
    asyncHandler(async (req, res) => {
      const { role } = roleBodySchema.parse(req.body);
      const userId = paramId(req.params.userId);
      if (!userId || !mongoose.isValidObjectId(userId)) {
        throw new AppError(400, "Invalid user id");
      }
      const user = await User.findByIdAndUpdate(
        userId,
        { $set: { role } },
        { new: true },
      )
        .select("email fullName role")
        .lean();
      if (!user) throw new AppError(404, "User not found");
      res.json({
        user: {
          id: user._id.toString(),
          email: user.email,
          fullName: user.fullName,
          role: user.role,
        },
      });
    }),
  );

  return router;
}

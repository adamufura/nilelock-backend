import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { User } from "../models/User.js";
import { Lock } from "../models/Lock.js";
import { RefreshSession } from "../models/RefreshSession.js";
import { AppError } from "../lib/AppError.js";

const createUserSchema = z.object({
  email: z.string().email().max(320),
  password: z.string().min(8).max(128),
  fullName: z.string().min(1).max(120).trim(),
  role: z.enum(["admin", "user"]).default("user"),
});

export async function adminCreateUser(
  body: unknown,
): Promise<{ id: string; email: string; fullName: string; role: string }> {
  const data = createUserSchema.parse(body);
  const existing = await User.findOne({ email: data.email });
  if (existing) throw new AppError(409, "Email already registered");

  const passwordHash = await bcrypt.hash(data.password, 12);
  const user = await User.create({
    email: data.email,
    fullName: data.fullName,
    passwordHash,
    role: data.role,
  });

  return {
    id: user._id.toString(),
    email: user.email,
    fullName: user.fullName,
    role: user.role,
  };
}

export async function adminDeleteUser(
  actorUserId: mongoose.Types.ObjectId,
  targetUserId: string,
): Promise<void> {
  if (!mongoose.isValidObjectId(targetUserId)) throw new AppError(400, "Invalid user id");
  const tid = new mongoose.Types.ObjectId(targetUserId);
  if (tid.equals(actorUserId)) throw new AppError(400, "You cannot delete your own account");

  const target = await User.findById(tid);
  if (!target) throw new AppError(404, "User not found");

  if (target.role === "admin") {
    const adminCount = await User.countDocuments({ role: "admin" });
    if (adminCount <= 1) throw new AppError(400, "Cannot delete the last administrator");
  }

  const ownsLocks = await Lock.exists({ owners: tid });
  if (ownsLocks) {
    throw new AppError(400, "User still owns locks; delete or reassign those locks first");
  }

  await RefreshSession.deleteMany({ user: tid });
  await User.deleteOne({ _id: tid });
}

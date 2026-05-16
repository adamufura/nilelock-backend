import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { User } from "../models/User.js";
import { RefreshSession } from "../models/RefreshSession.js";
import { AppError } from "../lib/AppError.js";
import { hashRefreshToken, newRefreshToken } from "../lib/tokens.js";
import { signAccessToken } from "../lib/jwt.js";
import type { Env } from "../config.js";

const registerSchema = z.object({
  email: z.string().email().max(320),
  password: z.string().min(8).max(128),
  fullName: z.string().min(1).max(120).trim(),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const refreshSchema = z.object({
  refreshToken: z.string().min(1),
});

export async function registerUser(
  env: Env,
  body: unknown,
): Promise<{ user: { id: string; email: string; fullName: string; role: string }; tokens: TokenPair }> {
  const data = registerSchema.parse(body);
  const existing = await User.findOne({ email: data.email });
  if (existing) throw new AppError(409, "Email already registered");

  const passwordHash = await bcrypt.hash(data.password, 12);
  const user = await User.create({
    email: data.email,
    fullName: data.fullName,
    passwordHash,
    role: "user",
  });

  const tokens = await issueTokens(env, user._id, user.role as "admin" | "user");
  return {
    user: {
      id: user._id.toString(),
      email: user.email,
      fullName: user.fullName,
      role: user.role,
    },
    tokens,
  };
}

export async function loginUser(env: Env, body: unknown): Promise<{
  user: { id: string; email: string; fullName: string; role: string };
  tokens: TokenPair;
}> {
  const data = loginSchema.parse(body);
  const user = await User.findOne({ email: data.email });
  if (!user) throw new AppError(401, "Invalid email or password");

  const ok = await bcrypt.compare(data.password, user.passwordHash);
  if (!ok) throw new AppError(401, "Invalid email or password");

  const tokens = await issueTokens(env, user._id, user.role as "admin" | "user");
  return {
    user: {
      id: user._id.toString(),
      email: user.email,
      fullName: user.fullName,
      role: user.role,
    },
    tokens,
  };
}

export type TokenPair = {
  accessToken: string;
  refreshToken: string;
  expiresIn: string;
};

async function issueTokens(
  env: Env,
  userId: mongoose.Types.ObjectId,
  role: "admin" | "user",
): Promise<TokenPair> {
  const accessToken = signAccessToken(userId, role, env.JWT_ACCESS_SECRET, env.JWT_ACCESS_EXPIRES);
  const refreshToken = newRefreshToken();
  const tokenHash = hashRefreshToken(refreshToken, env.JWT_REFRESH_SECRET);
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + env.JWT_REFRESH_EXPIRES_DAYS);

  await RefreshSession.create({ user: userId, tokenHash, expiresAt });

  return {
    accessToken,
    refreshToken,
    expiresIn: env.JWT_ACCESS_EXPIRES,
  };
}

export async function refreshTokens(env: Env, body: unknown): Promise<TokenPair> {
  const data = refreshSchema.parse(body);
  const tokenHash = hashRefreshToken(data.refreshToken, env.JWT_REFRESH_SECRET);
  const session = await RefreshSession.findOne({ tokenHash, expiresAt: { $gt: new Date() } });
  if (!session) throw new AppError(401, "Invalid or expired refresh token");

  const user = await User.findById(session.user);
  if (!user) throw new AppError(401, "User no longer exists");

  await RefreshSession.deleteOne({ _id: session._id });

  return issueTokens(env, user._id, user.role as "admin" | "user");
}

export async function logoutUser(env: Env, body: unknown): Promise<void> {
  const data = refreshSchema.parse(body);
  const tokenHash = hashRefreshToken(data.refreshToken, env.JWT_REFRESH_SECRET);
  await RefreshSession.deleteOne({ tokenHash });
}

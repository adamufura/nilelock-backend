import type { NextFunction, Request, Response } from "express";
import mongoose from "mongoose";
import { verifyAccessToken } from "../lib/jwt.js";
import { AppError } from "../lib/AppError.js";
import type { Env } from "../config.js";

export function authMiddleware(env: Env) {
  return (req: Request, _res: Response, next: NextFunction) => {
    const header = req.headers.authorization;
    if (!header?.startsWith("Bearer ")) {
      return next(new AppError(401, "Missing or invalid Authorization header"));
    }
    const token = header.slice(7).trim();
    if (!token) return next(new AppError(401, "Missing token"));

    try {
      const payload = verifyAccessToken(token, env.JWT_ACCESS_SECRET);
      req.auth = {
        userId: new mongoose.Types.ObjectId(payload.sub),
        role: payload.role,
      };
      next();
    } catch {
      next(new AppError(401, "Invalid or expired token"));
    }
  };
}

export function requireAdmin(req: Request, _res: Response, next: NextFunction) {
  if (req.auth?.role !== "admin") {
    return next(new AppError(403, "Administrator role required"));
  }
  next();
}

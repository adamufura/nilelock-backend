import type { Express } from "express";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import mongoose from "mongoose";
import rateLimit from "express-rate-limit";
import type { Server as SocketIOServer } from "socket.io";
import type { Env } from "./config.js";
import { createCorsOptions } from "./config.js";
import { errorHandler } from "./middleware/errorHandler.js";
import { authMiddleware, requireAdmin } from "./middleware/auth.js";
import { createAuthRouter } from "./routes/auth.js";
import { createLocksRouter } from "./routes/locks.js";
import { createEventsRouter } from "./routes/events.js";
import { createPublicRouter } from "./routes/public.js";
import { createAdminRouter } from "./routes/admin.js";
import { asyncHandler } from "./lib/asyncHandler.js";
import { User } from "./models/User.js";
import { AppError } from "./lib/AppError.js";

export function registerHttpRoutes(
  app: Express,
  deps: { env: Env; io: SocketIOServer },
): void {
  const { env, io } = deps;
  app.use(helmet());
  app.use(cors(createCorsOptions(env)));
  app.use(express.json({ limit: "64kb" }));
  app.use(morgan(env.NODE_ENV === "production" ? "combined" : "dev"));

  app.use(
    "/api",
    rateLimit({
      windowMs: 15 * 60 * 1000,
      max: 600,
      standardHeaders: true,
      legacyHeaders: false,
    }),
  );

  function dbConnected(): boolean {
    return mongoose.connection.readyState === 1;
  }

  app.get("/health", (_req, res) => {
    const ok = dbConnected();
    res.status(ok ? 200 : 503).json({
      ok,
      service: "nilelock-backend",
      database: ok ? "connected" : "disconnected",
    });
  });

  app.use("/api/public", createPublicRouter());

  const auth = authMiddleware(env);

  app.use("/api/auth", createAuthRouter(env));

  app.get(
    "/api/me",
    auth,
    asyncHandler(async (req, res) => {
      const u = await User.findById(req.auth!.userId).select("email fullName role").lean();
      if (!u) throw new AppError(404, "User not found");
      res.json({
        user: {
          id: req.auth!.userId.toString(),
          email: u.email,
          fullName: u.fullName,
          role: u.role,
        },
      });
    }),
  );

  app.use("/api/locks", auth, createLocksRouter(io));
  app.use("/api/events", auth, createEventsRouter());
  app.use("/api/admin", auth, requireAdmin, createAdminRouter());

  app.use(errorHandler);
}

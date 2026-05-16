import { Router } from "express";
import rateLimit from "express-rate-limit";
import type { Env } from "../config.js";
import { asyncHandler } from "../lib/asyncHandler.js";
import { loginUser, logoutUser, refreshTokens, registerUser } from "../services/authService.js";

export function createAuthRouter(env: Env): Router {
  const router = Router();

  const authBurst = rateLimit({
    windowMs: 60 * 1000,
    max: 30,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "Too many auth attempts, try again later" },
  });

  router.post(
    "/register",
    authBurst,
    asyncHandler(async (req, res) => {
      const { user, tokens } = await registerUser(env, req.body);
      res.status(201).json({ user, ...tokens });
    }),
  );

  router.post(
    "/login",
    authBurst,
    asyncHandler(async (req, res) => {
      const { user, tokens } = await loginUser(env, req.body);
      res.json({ user, ...tokens });
    }),
  );

  router.post(
    "/refresh",
    authBurst,
    asyncHandler(async (req, res) => {
      const tokens = await refreshTokens(env, req.body);
      res.json(tokens);
    }),
  );

  router.post(
    "/logout",
    authBurst,
    asyncHandler(async (req, res) => {
      await logoutUser(env, req.body);
      res.status(204).send();
    }),
  );

  return router;
}

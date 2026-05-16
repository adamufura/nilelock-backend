import type { NextFunction, Request, Response } from "express";
import { ZodError } from "zod";
import { AppError } from "../lib/AppError.js";

export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  if (err instanceof AppError) {
    res.status(err.statusCode).json({ error: err.message, code: err.code });
    return;
  }
  if (err instanceof ZodError) {
    res.status(400).json({
      error: "Validation failed",
      issues: err.flatten().fieldErrors,
    });
    return;
  }
  if (err instanceof Error && err.name === "JsonWebTokenError") {
    res.status(401).json({ error: "Invalid token" });
    return;
  }
  if (typeof err === "object" && err !== null && "code" in err && (err as { code: number }).code === 11000) {
    res.status(409).json({ error: "Duplicate key (e.g. email already registered)" });
    return;
  }
  console.error(err);
  res.status(500).json({ error: "Internal server error" });
}

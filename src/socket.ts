import type { Server as SocketIOServer } from "socket.io";
import mongoose from "mongoose";
import type { Env } from "./config.js";
import { verifyAccessToken } from "./lib/jwt.js";
import { findLockByRef } from "./lib/lockResolver.js";
import { canAccessLock, getLockOwners } from "./services/lockService.js";

export function attachSocketIO(io: SocketIOServer, env: Env): void {
  io.use((socket, next) => {
    const token = socket.handshake.auth?.token;
    if (typeof token !== "string" || !token.trim()) {
      next(new Error("Unauthorized"));
      return;
    }
    try {
      const payload = verifyAccessToken(token.trim(), env.JWT_ACCESS_SECRET);
      socket.data.userId = new mongoose.Types.ObjectId(payload.sub);
      socket.data.role = payload.role;
      next();
    } catch {
      next(new Error("Unauthorized"));
    }
  });

  io.on("connection", (socket) => {
    socket.on("lock:subscribe", async (lockRef: unknown, ack?: (r: unknown) => void) => {
      try {
        if (typeof lockRef !== "string" || !lockRef.trim()) {
          throw new Error("Invalid lock id");
        }
        const lock = await findLockByRef(lockRef);
        if (!lock) throw new Error("Lock not found");

        const uid = socket.data.userId as mongoose.Types.ObjectId;
        const role = socket.data.role as string;
        const owners = getLockOwners(lock);
        if (!canAccessLock(role as "admin" | "user", uid, owners)) {
          throw new Error("Forbidden");
        }

        const slug = lock.slug;
        await socket.join(`lock:${slug}`);
        socket.emit("lock:state", {
          lockId: slug,
          state: lock.state,
          updatedAt: lock.updatedAt?.toISOString() ?? new Date().toISOString(),
        });
        ack?.({ ok: true });
      } catch (e) {
        ack?.({ ok: false, error: e instanceof Error ? e.message : "error" });
      }
    });
  });

  const publicNs = io.of("/public");
  publicNs.on("connection", (socket) => {
    socket.on("lock:subscribe", async (lockRef: unknown, ack?: (r: unknown) => void) => {
      try {
        if (typeof lockRef !== "string" || !lockRef.trim()) {
          throw new Error("Invalid lock id");
        }
        const lock = await findLockByRef(lockRef);
        if (!lock) throw new Error("Lock not found");
        const slug = lock.slug;
        await socket.join(`lock:${slug}`);
        socket.emit("lock:state", {
          lockId: slug,
          state: lock.state,
          updatedAt: lock.updatedAt?.toISOString() ?? new Date().toISOString(),
        });
        ack?.({ ok: true });
      } catch (e) {
        ack?.({ ok: false, error: e instanceof Error ? e.message : "error" });
      }
    });
  });
}

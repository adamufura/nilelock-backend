import "dotenv/config";
import express from "express";
import { createServer } from "node:http";
import { Server as SocketIOServer } from "socket.io";
import { createCorsOptions, loadEnv } from "./config.js";
import { connectMongo, disconnectMongo } from "./db.js";
import { migrateLocksSchema } from "./migrations/ensureLockSlugs.js";
import { registerHttpRoutes } from "./httpRoutes.js";
import { attachSocketIO } from "./socket.js";
import { ensureSeedAdmins } from "./seed/admins.js";

async function main() {
  const env = loadEnv();

  const app = express();
  const httpServer = createServer(app);
  const corsOptions = createCorsOptions(env);

  const io = new SocketIOServer(httpServer, {
    cors: {
      origin: corsOptions.origin,
      methods: corsOptions.methods,
    },
  });

  await connectMongo(env.MONGODB_URI, env.MONGODB_DB_NAME);

  await migrateLocksSchema();
  await ensureSeedAdmins(env.SEED_ADMIN_PASSWORD);

  attachSocketIO(io, env);
  registerHttpRoutes(app, { env, io });

  const port = env.PORT;
  const host = "0.0.0.0";
  httpServer.listen(port, host, () => {
    console.log(`API + WebSocket listening on http://localhost:${port} (bound to ${host} — use LAN IP from phone)`);
  });

  const shutdown = async (signal: string) => {
    console.log(`${signal} received, closing…`);
    io.close();
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    await disconnectMongo();
    process.exit(0);
  };

  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

void main().catch((err) => {
  console.error(err);
  process.exit(1);
});

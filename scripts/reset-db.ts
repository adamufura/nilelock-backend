/**
 * Drops all non-system collections in the MongoDB database named by MONGODB_DB_NAME
 * (default: nilelock). Use after schema changes or when you want a clean slate.
 *
 * Usage: npm run db:reset -- --yes
 */
import "dotenv/config";
import mongoose from "mongoose";

const uri = process.env.MONGODB_URI?.trim();
const dbName = process.env.MONGODB_DB_NAME?.trim() || "nilelock";

async function main(): Promise<void> {
  if (!process.argv.includes("--yes")) {
    console.error("Refusing to run without --yes (this deletes all app data in the DB).");
    console.error("Run: npm run db:reset -- --yes");
    process.exit(1);
  }

  if (!uri) {
    console.error("MONGODB_URI is not set (check .env)");
    process.exit(1);
  }

  console.log("Connecting to MongoDB…");
  console.log("Database:", dbName);

  await mongoose.connect(uri, { dbName });

  const db = mongoose.connection.db;
  if (!db) {
    console.error("No database handle");
    process.exit(1);
  }

  const collections = await db.listCollections().toArray();
  const toDrop = collections.map((c) => c.name).filter((name) => !name.startsWith("system."));

  if (toDrop.length === 0) {
    console.log("No collections to drop.");
    await mongoose.disconnect();
    return;
  }

  for (const name of toDrop.sort()) {
    await db.collection(name).drop();
    console.log("Dropped:", name);
  }

  console.log(`Done. Removed ${toDrop.length} collection(s).`);
  await mongoose.disconnect();
}

void main().catch((err) => {
  console.error(err);
  process.exit(1);
});

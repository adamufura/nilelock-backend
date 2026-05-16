import mongoose from "mongoose";

const dbName = process.env.MONGODB_DB_NAME?.trim() || "nilelock";

export async function connectMongo(uri: string, databaseName?: string): Promise<void> {
  const name = databaseName?.trim() || dbName;

  mongoose.connection.on("error", (err) => {
    console.error("MongoDB connection error:", err.message);
  });

  await mongoose.connect(uri, { dbName: name });
  console.log("MongoDB connected, database:", mongoose.connection.name);
}

export async function disconnectMongo(): Promise<void> {
  await mongoose.disconnect();
}

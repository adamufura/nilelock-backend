import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  PORT: z.coerce.number().default(4000),
  MONGODB_URI: z.string().min(1),
  MONGODB_DB_NAME: z
    .string()
    .max(64)
    .optional()
    .transform((v) => (!v || !String(v).trim() ? "nilelock" : String(v).trim())),
  JWT_ACCESS_SECRET: z.string().min(16),
  JWT_REFRESH_SECRET: z.string().min(16),
  JWT_ACCESS_EXPIRES: z.string().default("15m"),
  JWT_REFRESH_EXPIRES_DAYS: z.coerce.number().default(14),
  CORS_ORIGIN: z.string().optional(),
  SEED_ADMIN_PASSWORD: z.string().min(8).max(128).default("nilelock"),
});

export type Env = z.infer<typeof envSchema>;

export function loadEnv(): Env {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    console.error("Invalid environment:", parsed.error.flatten().fieldErrors);
    process.exit(1);
  }
  return parsed.data;
}

export function parseCorsOrigins(raw: string | undefined): string[] | true {
  if (!raw?.trim()) return true;
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

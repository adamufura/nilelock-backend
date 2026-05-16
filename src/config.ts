import type { CorsOptions } from "cors";
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

export function parseCorsOriginsList(raw: string | undefined): string[] {
  if (!raw?.trim()) return [];
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/** @deprecated Prefer {@link createCorsOptions} */
export function parseCorsOrigins(raw: string | undefined): string[] | true {
  const list = parseCorsOriginsList(raw);
  return list.length === 0 ? true : list;
}

function originMatchesEasypanelSuffix(origin: string, suffix: string): boolean {
  try {
    const u = new URL(origin);
    const host = u.hostname;
    return (
      u.protocol === "https:" &&
      (host === suffix || host.endsWith(`.${suffix}`))
    );
  } catch {
    return false;
  }
}

export function createCorsOptions(env: Env): CorsOptions {
  const explicit = parseCorsOriginsList(env.CORS_ORIGIN);
  const strict = process.env.CORS_STRICT === "true";
  const easypanelSuffix =
    process.env.CORS_EASYPANEL_SUFFIX?.trim() ||
    (env.NODE_ENV === "production" ? "o9oxxq.easypanel.host" : undefined);

  const isAllowed = (origin: string): boolean => {
    if (explicit.includes(origin)) return true;
    if (strict || !easypanelSuffix) return false;
    return originMatchesEasypanelSuffix(origin, easypanelSuffix);
  };

  return {
    origin(origin, callback) {
      if (!origin) {
        callback(null, true);
        return;
      }
      if (
        explicit.length === 0 &&
        !strict &&
        env.NODE_ENV !== "production"
      ) {
        callback(null, true);
        return;
      }
      if (isAllowed(origin)) {
        callback(null, true);
        return;
      }
      callback(new Error(`CORS blocked origin: ${origin}`));
    },
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  };
}

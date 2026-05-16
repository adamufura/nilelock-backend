/**
 * Integration smoke tests for the NileLock HTTP API.
 * Start the server first: npm run dev
 * Run: npm run test:api
 *
 * Uses SEED_ADMIN_PASSWORD (default nilelock) and admin@nilelock.com unless overridden via env.
 */
import "dotenv/config";
import { randomBytes } from "node:crypto";

const BASE = process.env.API_BASE_URL?.replace(/\/$/, "") || "http://localhost:4000";
const ADMIN_EMAIL = process.env.TEST_ADMIN_EMAIL || "admin@nilelock.com";
const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD || "nilelock";

type Json = Record<string, unknown> | unknown[] | null;

let passed = 0;
let failed = 0;

function ok(name: string, cond: boolean, detail?: string): void {
  if (cond) {
    passed += 1;
    console.log(`  ✓ ${name}`);
  } else {
    failed += 1;
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

async function req(
  method: string,
  path: string,
  opts: {
    token?: string;
    body?: unknown;
    headers?: Record<string, string>;
  } = {},
): Promise<{ status: number; json: Json; text: string }> {
  const url = path.startsWith("http") ? path : `${BASE}${path}`;
  const headers: Record<string, string> = {
    Accept: "application/json",
    ...opts.headers,
  };
  if (opts.body !== undefined) {
    headers["Content-Type"] = "application/json";
  }
  if (opts.token) {
    headers.Authorization = `Bearer ${opts.token}`;
  }
  const res = await fetch(url, {
    method,
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  const text = await res.text();
  let json: Json = null;
  try {
    json = text ? (JSON.parse(text) as Json) : null;
  } catch {
    json = null;
  }
  return { status: res.status, json, text };
}

function asObj(v: Json): Record<string, unknown> | null {
  return v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

async function main(): Promise<void> {
  console.log(`API tests → ${BASE}\n`);

  // --- Health ---
  {
    const { status, json } = await req("GET", "/health");
    const o = asObj(json);
    ok("GET /health 200", status === 200, `status=${status}`);
    ok("GET /health ok", o?.ok === true && o?.database === "connected", JSON.stringify(json));
  }

  // --- Auth: bad login ---
  {
    const { status } = await req("POST", "/api/auth/login", {
      body: { email: ADMIN_EMAIL, password: "wrong-password-xyz" },
    });
    ok("POST /api/auth/login 401 invalid password", status === 401);
  }

  // --- Auth: no token ---
  {
    const { status } = await req("GET", "/api/me");
    ok("GET /api/me 401 without token", status === 401);
  }

  // --- Register random user ---
  const suffix = randomBytes(4).toString("hex");
  const userEmail = `apitest_${suffix}@nilelock.test`;
  let userId = "";
  let userAccess = "";
  let userRefresh = "";
  {
    const { status, json } = await req("POST", "/api/auth/register", {
      body: {
        email: userEmail,
        password: "testuserpw12",
        fullName: "API Test User",
      },
    });
    const o = asObj(json);
    ok("POST /api/auth/register 201", status === 201);
    ok("register returns user + tokens", Boolean(o?.user && o?.accessToken && o?.refreshToken));
    const u = asObj(o?.user as Json);
    if (typeof u?.id === "string") userId = u.id;
    if (typeof o?.accessToken === "string") userAccess = o.accessToken;
    if (typeof o?.refreshToken === "string") userRefresh = o.refreshToken as string;
    ok("registered user role is user", u?.role === "user");
  }

  // --- Duplicate register ---
  {
    const { status } = await req("POST", "/api/auth/register", {
      body: {
        email: userEmail,
        password: "anotherpass12",
        fullName: "Dup",
      },
    });
    ok("POST /api/auth/register 409 duplicate email", status === 409);
  }

  // --- Login admin ---
  let adminAccess = "";
  let adminRefresh = "";
  {
    const { status, json } = await req("POST", "/api/auth/login", {
      body: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
    });
    const o = asObj(json);
    ok("POST /api/auth/login admin 200", status === 200);
    if (typeof o?.accessToken === "string") adminAccess = o.accessToken;
    if (typeof o?.refreshToken === "string") adminRefresh = o.refreshToken as string;
    ok("admin login returns tokens", Boolean(adminAccess && adminRefresh));
  }

  // --- Me ---
  {
    const { status, json } = await req("GET", "/api/me", { token: adminAccess });
    const o = asObj(json);
    const u = asObj(o?.user as Json);
    ok("GET /api/me 200", status === 200);
    ok("me email matches admin", u?.email === ADMIN_EMAIL);
  }

  // --- Refresh ---
  {
    const { status, json } = await req("POST", "/api/auth/refresh", {
      body: { refreshToken: adminRefresh },
    });
    const o = asObj(json);
    ok("POST /api/auth/refresh 200", status === 200);
    if (typeof o?.accessToken === "string") adminAccess = o.accessToken;
    if (typeof o?.refreshToken === "string") adminRefresh = o.refreshToken as string;
    ok("refresh returns new tokens", Boolean(o?.accessToken && o?.refreshToken));
  }

  // --- User cannot admin routes ---
  {
    const { status } = await req("GET", "/api/admin/users", { token: userAccess });
    ok("GET /api/admin/users 403 as normal user", status === 403);
  }

  // --- User cannot create lock ---
  {
    const { status } = await req(
      "POST",
      "/api/locks",
      { token: userAccess, body: { name: "Should Fail" } },
    );
    ok("POST /api/locks 403 as normal user", status === 403);
  }

  // --- Admin create lock for user ---
  let lockId = "";
  {
    const { status, json } = await req("POST", "/api/locks", {
      token: adminAccess,
      body: {
        name: `API Test Lock ${suffix}`,
        location: "Script",
        ownerIds: [userId],
      },
    });
    const o = asObj(json);
    const lock = asObj(o?.lock as Json);
    ok("POST /api/locks 201 admin", status === 201);
    if (typeof lock?.id === "string") lockId = lock.id;
    ok("create lock returns public id", Boolean(lockId && !lockId.includes(" ")));
  }

  const lockPath = encodeURIComponent(lockId);

  // --- List locks (admin sees all) ---
  {
    const { status, json } = await req("GET", "/api/locks", { token: adminAccess });
    const o = asObj(json);
    const locks = o?.locks;
    ok("GET /api/locks 200 admin", status === 200);
    ok("locks array includes new lock", Array.isArray(locks) && locks.some((l) => asObj(l as Json)?.id === lockId));
  }

  // --- List locks (user sees own) ---
  {
    const { status, json } = await req("GET", "/api/locks", { token: userAccess });
    const o = asObj(json);
    const locks = o?.locks as unknown[] | undefined;
    ok("GET /api/locks 200 user", status === 200);
    ok("user sees assigned lock", Array.isArray(locks) && locks.length >= 1);
  }

  // --- Get lock by id ---
  {
    const { status, json } = await req("GET", `/api/locks/${lockPath}`, { token: userAccess });
    const o = asObj(json);
    const lock = asObj(o?.lock as Json);
    ok("GET /api/locks/:id 200", status === 200);
    ok("lock state locked", lock?.state === "locked");
  }

  // --- Set passcode (as owner user) ---
  {
    const { status, json } = await req("POST", `/api/locks/${lockPath}/passcode`, {
      token: userAccess,
      body: { code: "424242" },
    });
    const o = asObj(json);
    ok("POST /api/locks/:id/passcode 200", status === 200);
    ok("passcode ok", o?.ok === true);
  }

  // --- Command unlock (api channel — no passcode) ---
  {
    const { status, json } = await req("POST", `/api/locks/${lockPath}/command`, {
      token: userAccess,
      body: { action: "unlock" },
      headers: { "x-client-channel": "mobile" },
    });
    const o = asObj(json);
    ok("POST command unlock (mobile) 200", status === 200);
    ok("state unlocked", o?.state === "unlocked");
  }

  // --- Command lock ---
  {
    const { status, json } = await req("POST", `/api/locks/${lockPath}/command`, {
      token: userAccess,
      body: { action: "lock" },
    });
    const o = asObj(json);
    ok("POST command lock 200", status === 200);
    ok("state locked again", o?.state === "locked");
  }

  // --- Simulator unlock requires passcode ---
  {
    const { status } = await req("POST", `/api/locks/${lockPath}/command`, {
      token: userAccess,
      body: { action: "unlock" },
      headers: { "x-client-channel": "simulator" },
    });
    ok("POST simulator unlock without passcode 400", status === 400);
  }

  {
    const { status, json } = await req("POST", `/api/locks/${lockPath}/command`, {
      token: userAccess,
      body: { action: "unlock", passcode: "424242" },
      headers: { "x-client-channel": "simulator" },
    });
    const o = asObj(json);
    ok("POST simulator unlock with passcode 200", status === 200);
    ok("state unlocked via simulator", o?.state === "unlocked");
  }

  // --- Events ---
  {
    const { status, json } = await req("GET", "/api/events?limit=10", { token: adminAccess });
    const o = asObj(json);
    const events = o?.events;
    ok("GET /api/events 200", status === 200);
    ok("events is non-empty array", Array.isArray(events) && events.length > 0);
  }

  {
    const { status, json } = await req("GET", "/api/events?limit=5", { token: userAccess });
    const o = asObj(json);
    ok("GET /api/events 200 user", status === 200);
    ok("user events filtered", Array.isArray(o?.events));
  }

  // --- Admin users ---
  {
    const { status, json } = await req("GET", "/api/admin/users", { token: adminAccess });
    const o = asObj(json);
    const users = o?.users as unknown[] | undefined;
    ok("GET /api/admin/users 200", status === 200);
    ok("users list non-empty", Array.isArray(users) && users.length >= 2);
  }

  // --- PATCH role (fahad@nilelock.com -> user -> admin) ---
  let fahadId = "";
  {
    const { json } = await req("GET", "/api/admin/users", { token: adminAccess });
    const o = asObj(json);
    const users = (o?.users as unknown[]) || [];
    const fahad = users.map((u) => asObj(u as Json)).find((u) => u?.email === "fahad@nilelock.com");
    if (typeof fahad?.id === "string") fahadId = fahad.id;
  }
  if (fahadId) {
    const { status: s1 } = await req("PATCH", `/api/admin/users/${fahadId}/role`, {
      token: adminAccess,
      body: { role: "user" },
    });
    ok("PATCH admin user role -> user 200", s1 === 200);
    const { status: s2 } = await req("PATCH", `/api/admin/users/${fahadId}/role`, {
      token: adminAccess,
      body: { role: "admin" },
    });
    ok("PATCH admin user role -> admin 200", s2 === 200);
  } else {
    failed += 2;
    console.log("  ✗ PATCH role tests skipped (fahad@nilelock.com not in DB — run server once to seed)");
  }

  // --- Logout ---
  {
    const { status } = await req("POST", "/api/auth/logout", {
      body: { refreshToken: userRefresh },
    });
    ok("POST /api/auth/logout 204", status === 204);
  }

  // --- Refresh after logout should fail for that token ---
  {
    const { status } = await req("POST", "/api/auth/refresh", {
      body: { refreshToken: userRefresh },
    });
    ok("POST /api/auth/refresh 401 after logout", status === 401);
  }

  console.log(`\nDone: ${passed} passed, ${failed} failed`);
  if (failed > 0) {
    process.exit(1);
  }
}

void main().catch((e) => {
  console.error(e);
  process.exit(1);
});

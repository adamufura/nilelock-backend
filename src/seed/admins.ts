import bcrypt from "bcryptjs";
import { User } from "../models/User.js";

const SEEDED_ADMINS = [
  { email: "admin@nilelock.com", fullName: "Administrator" },
  { email: "fahad@nilelock.com", fullName: "Fahad" },
] as const;

/**
 * Ensures the two built-in admin accounts exist (idempotent).
 * Skips any email that already has a user row; does not reset passwords for existing users.
 */
export async function ensureSeedAdmins(seedPassword: string): Promise<void> {
  const passwordHash = await bcrypt.hash(seedPassword, 12);

  for (const admin of SEEDED_ADMINS) {
    const exists = await User.exists({ email: admin.email });
    if (exists) continue;

    await User.create({
      email: admin.email,
      fullName: admin.fullName,
      passwordHash,
      role: "admin",
    });
    console.log(`Seeded admin user: ${admin.email}`);
  }
}

import mongoose from "mongoose";
import { Lock } from "../models/Lock.js";
import { slugifyFromName } from "./lockSlug.js";

export async function allocateUniqueSlugFromName(
  name: string,
  options?: { excludeLockId?: mongoose.Types.ObjectId },
): Promise<string> {
  const base = slugifyFromName(name);
  let candidate = base;
  let n = 2;
  for (;;) {
    const filter: Record<string, unknown> = { slug: candidate };
    if (options?.excludeLockId) {
      filter._id = { $ne: options.excludeLockId };
    }
    const taken = await Lock.exists(filter);
    if (!taken) return candidate;
    candidate = `${base}-${n}`;
    n += 1;
    if (n > 10_000) throw new Error("Could not allocate unique slug");
  }
}

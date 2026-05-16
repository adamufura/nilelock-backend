import mongoose from "mongoose";
import { Lock } from "../models/Lock.js";
import { isLockSlugPattern, normalizeLockSlug } from "./lockSlug.js";

export async function findLockByRef(ref: string) {
  const raw = ref.trim();
  if (!raw) return null;
  const normalized = normalizeLockSlug(raw);
  if (isLockSlugPattern(normalized)) {
    const bySlug = await Lock.findOne({ slug: normalized });
    if (bySlug) return bySlug;
  }
  if (mongoose.isValidObjectId(raw)) {
    return Lock.findById(raw);
  }
  return null;
}

import mongoose from "mongoose";
import { Lock } from "../models/Lock.js";
import { Passcode } from "../models/Passcode.js";
import { allocateUniqueSlugFromName } from "../lib/uniqueLockSlug.js";
import { isLockSlugPattern, normalizeLockSlug } from "../lib/lockSlug.js";

/**
 * Migrates legacy locks (single owner, NILE-* slugs) to owners[] and URL slugs.
 */
export async function migrateLocksSchema(): Promise<void> {
  const docs = await Lock.collection.find({}).toArray();

  let migratedOwners = 0;
  let migratedSlugs = 0;

  for (const doc of docs) {
    const id = doc._id as mongoose.Types.ObjectId;
    const rawOwner = doc.owner as mongoose.Types.ObjectId | undefined;
    const rawOwners = doc.owners as mongoose.Types.ObjectId[] | undefined;

    let owners: mongoose.Types.ObjectId[] = [];
    if (Array.isArray(rawOwners) && rawOwners.length > 0) {
      owners = rawOwners;
    } else if (rawOwner) {
      owners = [rawOwner];
    }

    const name = typeof doc.name === "string" ? doc.name : "Lock";
    const slugStr = typeof doc.slug === "string" ? doc.slug : "";
    const normalized = normalizeLockSlug(slugStr);

    const $set: Record<string, unknown> = {};
    const $unset: Record<string, string> = {};

    if (owners.length > 0) {
      if (!Array.isArray(rawOwners) || rawOwners.length === 0) {
        $set.owners = owners;
        migratedOwners += 1;
      }
    }

    if (doc.owner !== undefined) {
      $unset.owner = "";
    }

    if (!isLockSlugPattern(normalized)) {
      $set.slug = await allocateUniqueSlugFromName(name, { excludeLockId: id });
      migratedSlugs += 1;
    } else if (slugStr !== normalized) {
      $set.slug = normalized;
    }

    if (Object.keys($set).length > 0 || Object.keys($unset).length > 0) {
      await Lock.collection.updateOne(
        { _id: id },
        {
          ...(Object.keys($set).length > 0 ? { $set } : {}),
          ...(Object.keys($unset).length > 0 ? { $unset } : {}),
        },
      );
    }
  }

  const orphans = await Passcode.find({
    $or: [{ forUser: { $exists: false } }, { forUser: null }],
  }).lean();

  for (const p of orphans) {
    const lockDoc = await Lock.findById(p.lock as mongoose.Types.ObjectId).select("owners").lean();
    const own = (lockDoc?.owners as mongoose.Types.ObjectId[]) ?? [];
    if (own[0]) {
      await Passcode.updateOne({ _id: p._id }, { $set: { forUser: own[0] } });
    }
  }

  if (migratedOwners > 0 || migratedSlugs > 0) {
    console.log(`Lock migration: owner array fixes ${migratedOwners}, slug fixes ${migratedSlugs}`);
  }
}

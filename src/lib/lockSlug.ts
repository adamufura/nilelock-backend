/** URL-safe lock slug: lowercase letters, digits, hyphens (e.g. exam-hall-door). */
export const LOCK_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function normalizeLockSlug(input: string): string {
  return input.trim().toLowerCase();
}

export function isLockSlugPattern(value: string): boolean {
  return LOCK_SLUG_PATTERN.test(normalizeLockSlug(value));
}

/** Convert display name to a slug base (not necessarily unique). */
export function slugifyFromName(name: string): string {
  const s = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return s || "lock";
}

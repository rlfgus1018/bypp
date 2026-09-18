import { existsSync, mkdirSync, readdirSync, unlinkSync } from "node:fs";
import path from "node:path";
import type { Db } from "./client";

// A copy of the whole database, taken before anything that rewrites or deletes a lot at once: a schema
// migration, `repair:calendar -- --apply`, deleting a chat's data, or `npm run backup:db`.
// VACUUM INTO is synchronous and consistent (it reads one snapshot), and never modifies the source.

/** Backups kept per directory; older ones are removed after each new backup. */
export const BACKUP_KEEP = 10;
const BACKUP_FILE = /^bypp-\d{8}-\d{6}-[a-z0-9-]+\.db$/;

const pad = (n: number, width = 2) => String(n).padStart(width, "0");

/** YYYYMMDD-HHmmss in KST, so the names read the way the rest of the app shows time. */
function stamp(now: Date): string {
  const kst = new Date(now.getTime() + 9 * 3_600_000);
  return `${kst.getUTCFullYear()}${pad(kst.getUTCMonth() + 1)}${pad(kst.getUTCDate())}-${pad(kst.getUTCHours())}${pad(kst.getUTCMinutes())}${pad(kst.getUTCSeconds())}`;
}

/** Where backups of this database go: a `backups` folder next to the database file. */
export function backupDirFor(db: Db): string {
  return path.join(path.dirname(path.resolve(db.name)), "backups");
}

/**
 * Copies the database to `<dir>/bypp-<KST time>-<reason>.db` and prunes old copies. Returns the new file,
 * or null for an in-memory database (tests), which has nothing to lose. Must not run inside a transaction.
 */
export function backupDb(db: Db, reason: string, { dir = backupDirFor(db), keep = BACKUP_KEEP, now = new Date() } = {}): string | null {
  if (db.memory) return null;
  mkdirSync(dir, { recursive: true });
  const safeReason = reason.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "manual";
  let file = path.join(dir, `bypp-${stamp(now)}-${safeReason}.db`);
  for (let n = 2; existsSync(file); n++) file = path.join(dir, `bypp-${stamp(now)}-${safeReason}-${n}.db`);
  db.prepare("VACUUM INTO ?").run(file);

  const backups = readdirSync(dir)
    .filter((name) => BACKUP_FILE.test(name))
    .sort();
  for (const old of backups.slice(0, Math.max(0, backups.length - keep))) unlinkSync(path.join(dir, old));
  return file;
}

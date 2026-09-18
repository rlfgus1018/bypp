import { mkdirSync } from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { backfillApprovedCandidates } from "@/lib/calendar/candidate-event-link";
import { normalizeForMatch } from "@/lib/importance/match";
import { backupDb } from "./backup";
import { ADDED_COLUMNS, SCHEMA_SQL, SCHEMA_VERSION } from "./schema";
import { isSessionId, openSessionDb, SESSION_COOKIE, sessionDir } from "./session";

export type Db = Database.Database;

export function createDb(filePath: string): Db {
  if (filePath !== ":memory:") mkdirSync(path.dirname(path.resolve(filePath)), { recursive: true });
  const db = new Database(filePath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  registerFunctions(db);
  migrate(db);
  return db;
}

// Connections that got this module's SQL functions. Module-level on purpose: a hot reload loads a new copy of
// this module (and of normalizeForMatch), so a connection kept across the reload is registered again once.
const withFunctions = new WeakSet<Db>();

/** The importance keyword rule, identical in SQL and in JS: one function, registered on every connection. */
function registerFunctions(db: Db): void {
  if (withFunctions.has(db)) return;
  db.function("bypp_norm", { deterministic: true }, (text: unknown) => normalizeForMatch(typeof text === "string" ? text : null));
  withFunctions.add(db);
}

/**
 * Idempotent: creates missing tables and adds columns introduced after a database was first created.
 * An existing file database is copied to data/backups first whenever it is about to be upgraded.
 */
function migrate(db: Db): void {
  const previous = db.pragma("user_version", { simple: true }) as number;
  const hasTables = (db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table'").get() as { n: number }).n > 0;
  if (previous < SCHEMA_VERSION && hasTables) backupDb(db, `before-v${SCHEMA_VERSION}`);
  db.exec(SCHEMA_SQL);
  for (const { table, column, ddl } of ADDED_COLUMNS) {
    const columns = db.pragma(`table_info(${table})`) as { name: string }[];
    if (!columns.some((existing) => existing.name === column)) db.exec(ddl);
  }
  // v3 introduced the calendar: candidates approved before it existed get their event, once.
  // (This is the only write outside the status-change paths; page renders never reconcile.)
  if (previous < 3) backfillApprovedCandidates(db);
  db.pragma(`user_version = ${SCHEMA_VERSION}`);
}

// One connection per process, surviving Next.js dev hot reloads (single-database mode).
const globalForDb = globalThis as unknown as { __byppDb?: Db; __byppEmptyDb?: Db };

/** A connection kept across a hot reload may predate a schema change or a SQL function added in that reload. */
function refreshed(db: Db): Db {
  registerFunctions(db);
  if (db.pragma("user_version", { simple: true }) !== SCHEMA_VERSION) migrate(db);
  return db;
}

function singleDb(): Db {
  globalForDb.__byppDb ??= createDb(process.env.DB_PATH || "./data/bypp.db");
  return refreshed(globalForDb.__byppDb);
}

/** The schema with no rows, in memory and read-only: what a session that has stored nothing yet reads from. */
function emptyDb(): Db {
  if (!globalForDb.__byppEmptyDb?.open) {
    const db = createDb(":memory:");
    db.pragma("query_only = ON"); // shared by every such session: nothing may ever be written to it
    globalForDb.__byppEmptyDb = db;
  }
  registerFunctions(globalForDb.__byppEmptyDb);
  return globalForDb.__byppEmptyDb;
}

/** The current request's session id (set by src/proxy.ts), or null. Read from the HttpOnly cookie only. */
async function requestSessionId(): Promise<string | null> {
  const { cookies } = await import("next/headers");
  const value = (await cookies()).get(SESSION_COOKIE)?.value;
  return isSessionId(value) ? value : null;
}

/**
 * The database for code that WRITES (uploads, server actions, the Google connection).
 * Session mode (BYPP_SESSION_DIR): this browser's own database, created on its first write. Otherwise the single
 * database. A session database is only ever reached through the requesting browser's own cookie.
 */
export async function getDb(): Promise<Db> {
  const dir = sessionDir();
  if (!dir) return singleDb();
  const sessionId = await requestSessionId();
  if (!sessionId) throw new Error("no session"); // the proxy gives every request one; never fall back to a shared DB
  return refreshed(openSessionDb(dir, sessionId, { create: true, open: createDb })!);
}

/**
 * The database for code that only READS (page renders, counts). Same as getDb(), except that a session which
 * has stored nothing yet gets an empty read-only database: just visiting pages creates no file.
 */
export async function getReadDb(): Promise<Db> {
  const dir = sessionDir();
  if (!dir) return singleDb();
  const sessionId = await requestSessionId();
  const db = sessionId ? openSessionDb(dir, sessionId, { create: false, open: createDb }) : null;
  return db ? refreshed(db) : emptyDb();
}

/** Keys per-session in-process state (e.g. the extraction queue). Never shown, logged or sent anywhere. */
export async function sessionKey(): Promise<string> {
  return sessionDir() ? ((await requestSessionId()) ?? "none") : "single";
}

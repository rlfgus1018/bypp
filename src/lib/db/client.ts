import { mkdirSync } from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { backfillApprovedCandidates } from "@/lib/calendar/candidate-event-link";
import { normalizeForMatch } from "@/lib/importance/match";
import { ADDED_COLUMNS, SCHEMA_SQL, SCHEMA_VERSION } from "./schema";

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

/** Idempotent: creates missing tables and adds columns introduced after a database was first created. */
function migrate(db: Db): void {
  const previous = db.pragma("user_version", { simple: true }) as number;
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

// One connection per process, surviving Next.js dev hot reloads.
const globalForDb = globalThis as unknown as { __byppDb?: Db };

export function getDb(): Db {
  globalForDb.__byppDb ??= createDb(process.env.DB_PATH || "./data/bypp.db");
  // A connection kept across a hot reload may predate a schema change or a SQL function added in that reload.
  registerFunctions(globalForDb.__byppDb);
  if (globalForDb.__byppDb.pragma("user_version", { simple: true }) !== SCHEMA_VERSION) migrate(globalForDb.__byppDb);
  return globalForDb.__byppDb;
}

import { mkdirSync } from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { backfillApprovedCandidates } from "@/lib/calendar/candidate-event-link";
import { ADDED_COLUMNS, SCHEMA_SQL, SCHEMA_VERSION } from "./schema";

export type Db = Database.Database;

export function createDb(filePath: string): Db {
  if (filePath !== ":memory:") mkdirSync(path.dirname(path.resolve(filePath)), { recursive: true });
  const db = new Database(filePath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  migrate(db);
  return db;
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
  // A connection kept across a hot reload may predate a schema change made in that reload.
  if (globalForDb.__byppDb.pragma("user_version", { simple: true }) !== SCHEMA_VERSION) migrate(globalForDb.__byppDb);
  return globalForDb.__byppDb;
}

import { existsSync } from "node:fs";
import path from "node:path";
import type { Db } from "./client";

// Anonymous per-browser sessions (no login): when BYPP_SESSION_DIR is set, every browser gets its own SQLite
// file — <dir>/<session id>/bypp.db — with the ordinary schema. Uploads, candidates, the calendar, important
// keywords AND the Google connection (tokens, OAuth state) all live in that file, so nothing one visitor does
// is visible to another. Without the variable the app keeps its single database (local use, scripts).
//
// The id is a bearer secret: 256 random bits in an HttpOnly cookie (set by src/proxy.ts). It never appears in a
// URL, in client JavaScript or in a log line.

export const SESSION_COOKIE = "bypp_sid";
/** 180 days, renewed by the proxy whenever it has to set the cookie. */
export const SESSION_MAX_AGE_SECONDS = 180 * 24 * 60 * 60;

/** Exactly what randomBytes(32).toString("base64url") produces — and nothing that could leave the directory. */
const SESSION_ID = /^[A-Za-z0-9_-]{43}$/;
export const isSessionId = (value: unknown): value is string => typeof value === "string" && SESSION_ID.test(value);

type Env = Record<string, string | undefined>;

/** The directory holding the session databases, or null = single-database mode. Only this variable turns it on. */
export function sessionDir(env: Env = process.env): string | null {
  const dir = env.BYPP_SESSION_DIR?.trim();
  return dir ? path.resolve(dir) : null;
}

export function sessionDbPath(dir: string, sessionId: string): string {
  if (!isSessionId(sessionId)) throw new Error("invalid session id");
  return path.join(dir, sessionId, "bypp.db");
}

/** Open connections are kept this long after their last use, however many there are (a slow extraction holds one). */
const IDLE_CLOSE_MS = 10 * 60_000;
/** Above this many open connections, idle ones are closed. */
const MAX_OPEN = 50;

type Entry = { db: Db; usedAt: number };
// Survives Next.js dev hot reloads, like the single connection does.
const globalForSessions = globalThis as unknown as { __byppSessionDbs?: Map<string, Entry> };
const cache = (): Map<string, Entry> => (globalForSessions.__byppSessionDbs ??= new Map());

/**
 * The session's database.
 *   create: true  — opened, and created (file + schema) if this is the session's first write
 *   create: false — opened only if the file already exists; null otherwise, so merely viewing pages never
 *                   creates anything on disk
 * `open` is createDb (passed in to keep this module free of import cycles and easy to test).
 */
export function openSessionDb(
  dir: string,
  sessionId: string,
  { create, open, nowMs = Date.now() }: { create: boolean; open: (file: string) => Db; nowMs?: number },
): Db | null {
  const file = sessionDbPath(dir, sessionId); // validates the id before it touches the file system
  const connections = cache();
  const key = file;
  const cached = connections.get(key);
  if (cached?.db.open) {
    cached.usedAt = nowMs;
    return cached.db;
  }
  if (!create && !existsSync(file)) return null;

  const db = open(file);
  connections.set(key, { db, usedAt: nowMs });
  if (connections.size > MAX_OPEN) {
    for (const [otherKey, entry] of connections) {
      if (otherKey !== key && nowMs - entry.usedAt > IDLE_CLOSE_MS) {
        entry.db.close();
        connections.delete(otherKey);
      }
    }
  }
  return db;
}

/** For tests: close and forget every cached session connection. */
export function closeSessionDbs(): void {
  for (const { db } of cache().values()) if (db.open) db.close();
  cache().clear();
}

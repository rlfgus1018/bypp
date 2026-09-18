// Copies the local database to data/backups/bypp-<KST time>-manual.db (the last 10 backups are kept).
//
//   npm run backup:db
//
// Opens the file directly — no migration, no repair — so the copy is exactly what is on disk now.
import { existsSync } from "node:fs";
import Database from "better-sqlite3";
import { backupDb } from "../src/lib/db/backup";

const path = process.env.DB_PATH || "./data/bypp.db";
if (!existsSync(path)) {
  console.error(`database not found: ${path}`);
  process.exit(1);
}

const db = new Database(path, { fileMustExist: true });
const file = backupDb(db, "manual");
db.close();
console.log(`backup written: ${file}`);

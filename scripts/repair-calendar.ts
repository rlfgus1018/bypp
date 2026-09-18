// Maintenance tool: checks (and, with --apply, restores) the link between review status and calendar events.
//
//   npm run repair:calendar              → dry run: report only, repairs nothing
//   npm run repair:calendar -- --apply   → back the database up, then create missing events and delete stale ones
//
// Opening the database may upgrade an older schema first (it is backed up before that, too).
//
// The app never needs this in normal use (status changes are transactional); it exists for a database
// that was edited by hand or interrupted mid-write. It prints ids and counts only, never message content.
import { existsSync, readFileSync } from "node:fs";
import { reconcileCalendar } from "../src/lib/calendar/candidate-event-link";
import { backupDb } from "../src/lib/db/backup";
import { createDb } from "../src/lib/db/client";

function loadDotEnv() {
  for (const name of [".env.local", ".env"]) {
    if (!existsSync(name)) continue;
    for (const line of readFileSync(name, "utf8").split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  }
}

loadDotEnv();
const apply = process.argv.includes("--apply");
const path = process.env.DB_PATH || "./data/bypp.db";
if (!existsSync(path)) {
  console.error(`database not found: ${path}`);
  process.exit(1);
}

const db = createDb(path);
const backup = apply ? backupDb(db, "before-repair") : null;
const report = reconcileCalendar(db, { apply });
db.close();

console.log(`database            : ${path}`);
console.log(`mode                : ${apply ? "APPLY" : "dry run (no repairs made)"}`);
if (backup) console.log(`backup              : ${backup}`);
console.log(`approved, no event  : ${report.missingEvents.length}${apply ? " → created" : ""}`);
console.log(`event, not approved : ${report.staleEvents.length}${apply ? " → deleted" : ""}`);
console.log(`candidate deleted   : ${report.orphanedEvents.length} (reported only; these events are kept)`);
for (const [label, ids] of Object.entries({ missing: report.missingEvents, stale: report.staleEvents, orphaned: report.orphanedEvents }))
  for (const id of ids.slice(0, 20)) console.log(`  ${label.padEnd(8)} ${id}`);
if (!apply && report.missingEvents.length + report.staleEvents.length > 0) console.log("\nre-run with -- --apply to repair.");

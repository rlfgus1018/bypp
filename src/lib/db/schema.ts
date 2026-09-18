export const SCHEMA_VERSION = 4;

export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS imports (
  id TEXT PRIMARY KEY,
  filename TEXT NOT NULL,
  file_sha256 TEXT NOT NULL,
  container TEXT NOT NULL,
  room_name TEXT,
  total_parsed INTEGER NOT NULL,
  new_messages INTEGER NOT NULL,
  duplicate_messages INTEGER NOT NULL,
  skipped_non_text INTEGER NOT NULL,
  detected_count INTEGER NOT NULL,
  system_lines INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  -- v2: the extraction period chosen at upload (inclusive KST dates, NULL = open) and what it held back
  range_from TEXT,
  range_to TEXT,
  out_of_range_count INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  fingerprint TEXT NOT NULL UNIQUE,
  source TEXT NOT NULL DEFAULT 'KAKAO_EXPORT',
  room_name TEXT,
  sent_at TEXT NOT NULL,
  sender TEXT NOT NULL,
  text TEXT NOT NULL,
  kind TEXT NOT NULL,
  processing_status TEXT NOT NULL,
  detection_signals TEXT,
  extraction_error TEXT,
  first_import_id TEXT REFERENCES imports(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_messages_status ON messages(processing_status, sent_at);

CREATE TABLE IF NOT EXISTS schedule_candidates (
  id TEXT PRIMARY KEY,
  source_message_id TEXT NOT NULL REFERENCES messages(id),
  candidate_index INTEGER NOT NULL,
  action TEXT NOT NULL,
  title TEXT,
  start_at TEXT,
  end_at TEXT,
  all_day INTEGER NOT NULL DEFAULT 0,
  location TEXT,
  category TEXT NOT NULL,
  confidence REAL NOT NULL,
  reasoning_summary TEXT,
  source_excerpt TEXT,
  extractor TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING',
  status_changed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (source_message_id, candidate_index)
);
CREATE INDEX IF NOT EXISTS idx_candidates_status ON schedule_candidates(status);

-- v3 (M2-A): the user's own schedule. A candidate is the extraction record; this is what the user manages
-- and what any external calendar will sync from. Deliberately provider-agnostic: no Google/sync columns here.
CREATE TABLE IF NOT EXISTS calendar_events (
  id TEXT PRIMARY KEY,
  -- NULL is allowed (future manual events); UNIQUE still gives "one derived event per candidate".
  -- SET NULL: deleting an extraction record must not delete a schedule the user may have edited.
  candidate_id TEXT UNIQUE REFERENCES schedule_candidates(id) ON DELETE SET NULL,
  origin TEXT NOT NULL DEFAULT 'CANDIDATE',
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  start_at TEXT,
  end_at TEXT,
  all_day INTEGER NOT NULL DEFAULT 0,
  location TEXT,
  category TEXT NOT NULL,
  edited_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_calendar_events_start ON calendar_events(start_at);

-- v4 (M2-B): everything about the outside world lives below; calendar_events stays provider-agnostic.

-- The one Google account this single-user app is connected to. Tokens are stored sealed (see token-seal.ts)
-- and never leave the server.
CREATE TABLE IF NOT EXISTS google_connections (
  id TEXT PRIMARY KEY CHECK (id = 'default'),
  account_sub TEXT NOT NULL,           -- verified OIDC subject: the stable identity of the Google account
  account_email TEXT,
  refresh_token TEXT,
  access_token TEXT,
  access_expires_at TEXT,
  scope TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('CONNECTED', 'NEEDS_RECONNECT')),
  status_reason TEXT,                  -- a safe code, never provider text
  connected_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- One-time OAuth "state" values (only their SHA-256), consumed before the code is exchanged.
CREATE TABLE IF NOT EXISTS oauth_states (
  state_hash TEXT PRIMARY KEY,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

-- One row per (local event, provider). No row = never sent.
--   SYNCING   claimed by a request that holds the lease       SYNCED  created (or found) on Google
--   FAILED    known not to exist remotely                     UNCERTAIN  sent, outcome unknown — the next
--   PENDING   reserved for a future queue; not written today            attempt looks the event up first
-- CASCADE: removing a local event also removes this history; the Google event itself is never deleted by BYPP.
CREATE TABLE IF NOT EXISTS calendar_syncs (
  id TEXT PRIMARY KEY,
  calendar_event_id TEXT NOT NULL REFERENCES calendar_events(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (provider = 'google'),
  external_event_id TEXT,              -- set only once the remote event is confirmed
  sync_status TEXT NOT NULL CHECK (sync_status IN ('PENDING', 'SYNCING', 'SYNCED', 'FAILED', 'UNCERTAIN')),
  synced_at TEXT,
  last_error TEXT,                     -- a safe code, never provider text
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  -- what a safe retry needs
  reserved_event_id TEXT NOT NULL,     -- the Google event id every attempt for this local event uses
  account_sub TEXT NOT NULL,           -- 'primary' is per account: which account the attempts went to
  target_calendar_id TEXT NOT NULL,
  sent_hash TEXT,                      -- hash of the payload last sent: tells "created" from "edited since"
  attempt_count INTEGER NOT NULL DEFAULT 0,
  claim_id TEXT,
  lease_expires_at TEXT,
  UNIQUE (calendar_event_id, provider)
);
`;

/** Columns added after v1. CREATE TABLE IF NOT EXISTS never alters an existing table, so old DBs get these. */
export const ADDED_COLUMNS: { table: string; column: string; ddl: string }[] = [
  { table: "imports", column: "range_from", ddl: "ALTER TABLE imports ADD COLUMN range_from TEXT" },
  { table: "imports", column: "range_to", ddl: "ALTER TABLE imports ADD COLUMN range_to TEXT" },
  { table: "imports", column: "out_of_range_count", ddl: "ALTER TABLE imports ADD COLUMN out_of_range_count INTEGER NOT NULL DEFAULT 0" },
];

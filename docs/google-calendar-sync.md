# M2-B — Google Calendar CREATE sync

Implemented 2026-09-19. One-way, one event at a time, only when the user presses the button on a local event.

```text
ScheduleCandidate → Local CalendarEvent → event-mapper → GoogleCalendarApi → Google Calendar
                                                ↓
                                          calendar_syncs
```

The Google layer (`src/lib/google/`) reads the **Local CalendarEvent only**. It imports nothing from the
candidate / message / extraction / AI layers (ESLint rule + a test that scans its imports). A locally edited
event is sent with its edited values; an event with `candidateId = null` syncs the same way.

## Official documents consulted (2026-09-19)

| Document | What it decided |
|---|---|
| [Web Server OAuth 2.0](https://developers.google.com/identity/protocols/oauth2/web-server) | `response_type=code`, `access_type=offline`, `prompt=consent` to obtain a refresh token, `state`, granular consent (check the returned `scope`), `invalid_grant` |
| [OAuth best practices](https://developers.google.com/identity/protocols/oauth2/resources/best-practices) | secrets stay server-side and out of the repo; tokens stored at rest, never logged |
| [Calendar scopes](https://developers.google.com/workspace/calendar/api/auth) | scope choice below |
| [events.insert](https://developers.google.com/workspace/calendar/api/v3/reference/events/insert) | `start`/`end` required, `end` exclusive, caller-supplied `id`, accepts `calendar.events.owned` |
| [Events resource](https://developers.google.com/workspace/calendar/api/v3/reference/events) | id alphabet (base32hex: `a–v`, `0–9`, 5–1024 chars), all-day `date` with exclusive end, `extendedProperties.private`; "we cannot guarantee that ID collisions will be detected at event creation time" |
| [events.get](https://developers.google.com/workspace/calendar/api/v3/reference/events/get) | accepts `calendar.events.owned`; used to verify an uncertain creation |
| [google-api-nodejs-client](https://github.com/googleapis/google-api-nodejs-client) | SDK packages below |

**SDK**: `google-auth-library` (OAuth) and `@googleapis/calendar` (the official per-API package; the full
`googleapis` bundle is not needed). Each is imported by exactly one file: `google-oauth-client.ts`,
`google-calendar-api.ts`. Everything else talks to the `GoogleOAuthClient` / `GoogleCalendarApi` interfaces,
which is what the tests fake.

**Scopes**: `https://www.googleapis.com/auth/calendar.events.owned` + `openid email`.
- `calendar.events.owned` is accepted by both `events.insert` and `events.get` and covers only calendars the
  user owns — enough for the primary calendar. `calendar.events` (also calendars merely shared with the user)
  and `calendar` (full management, restricted) are not requested.
- `openid` gives a verified `sub`: the only stable way to tell "the same account again" from "another
  account". `email` is shown in the UI so the user can see whose calendar receives events.

## OAuth flow

- `GET /api/auth/google` — creates a 256-bit random `state`, stores its SHA-256 in `oauth_states` (10 min),
  sets it in an `HttpOnly; SameSite=Lax` cookie scoped to `/api/auth/google` (`Secure` when the redirect URI is
  https), and redirects to Google. It sends nothing else anywhere. The UI links to it with a plain `<a>` so
  Next.js never prefetches it.
- `GET /api/auth/google/callback` — the state must equal the cookie **and** be consumed from `oauth_states`
  (single use, unexpired) *before* the code is exchanged. Then: exchange on the server → verify the ID token →
  check the granted scope → store. The browser is redirected to the fixed path `/calendar?google=<result code>`.
  No code, state, token or caller-supplied URL is ever echoed. Connecting creates no calendar event.
- Refresh tokens: `prompt=consent` is used whenever no usable refresh token is held. A response without a
  refresh token keeps the stored one **only for the same verified `sub`**; a first connection without one is
  reported as "reconnect needed", not as connected. The connection is never silently swapped to another
  account once events were sent with the current one (`other_account`).
- Access tokens are refreshed 60 s before expiry, at most once per operation; a rotated refresh token is
  written in the same statement as the access token. `invalid_grant`, a missing scope or an unreadable stored
  token → `NEEDS_RECONNECT`. A network failure changes nothing.
- SDK error objects are never logged or stored (they contain request headers and token responses); they are
  reduced to a code at the boundary (`GoogleAuthError`, `GoogleApiError`) and mapped to Korean text for the UI.

**Token storage**: table `google_connections` in the app's SQLite file (`data/`, git-ignored, outside
`public/`). Tokens never reach a component, the RSC payload, a cookie or an API response — the UI gets a
`ConnectionView` (state + email). With `GOOGLE_TOKEN_ENCRYPTION_KEY` (32 bytes, base64) tokens are sealed with
AES-256-GCM; the key is separate from the database and is not derived from the client secret. **Without the
key they are stored unencrypted**, protected only by file access — the same boundary that protects
`.env.local` and the chat data on this single-user machine.

**Logging**: `next.config.ts` excludes `/api/auth/google*` from the dev server's request log (the callback
query holds the single-use code and state); production builds do not log requests. Remaining limits: the
callback URL stays in the browser's history, and a reverse proxy in front of the app would log it on its own.
Both values are useless after the exchange (the code is single-use, the state is consumed).

## `calendar_syncs` and never creating twice

One row per `(calendar_event_id, provider='google')`; no row = never sent. `external_event_id` is set **only**
after the remote event is confirmed; the id every attempt uses is kept separately in `reserved_event_id`
(`sha256("bypp:calendar-event:<local id>")`, first 40 hex chars — stable, legal, persisted before the request).

| status | meaning |
|---|---|
| `SYNCING` | claimed; `claim_id` + `lease_expires_at` (5 min) identify the holder |
| `SYNCED` | created, or found to be already created; `external_event_id`, `synced_at` set, `last_error` cleared |
| `FAILED` | known not to exist remotely (`last_error` = a safe code) |
| `UNCERTAIN` | a request was sent and its outcome could not be established |
| `PENDING` | allowed by the schema for a future queue; not written today |

1. The action receives a local event **id** only; title/time/place are re-read from the database.
2. Refusals that cost no API call: unknown id, notices, no date, empty title, bad date, bad interval (an
   explicit end ≤ start, or an all-day event without an end), not connected.
   **A timed event without an end time** (a meeting, a `DEADLINE`) **is sent** as an ordinary event from start
   to `start + 60 min` (`DEFAULT_GOOGLE_EVENT_DURATION_MINUTES`, real instant arithmetic, canonical KST — day,
   month and year roll over). `endTimeUnspecified` is **not** sent: Google rejected such inserts with 400
   (`bad_request`) in real use (2026-09-19). The one hour is a default, not an inferred end: the local
   `calendar_events.end_at` stays `NULL`, and an explicit end is always used as given (a wrong one stays
   blocked, never replaced by the default). Single and bulk send use the same `toGoogleEvent()`; both show
   "종료 시각 미입력 · Google에는 시작 후 1시간 일정으로 생성됩니다." (bulk: a "종료 미입력" badge and a count in
   the confirmation). `sent_hash` is unchanged: such an event hashes like one with an explicit one-hour end.
3. **Claim** in an `IMMEDIATE` transaction: `SYNCED` → "already", live lease → "in progress", otherwise take
   the lease. No transaction is open during network calls.
4. Any attempt after the first **looks the reserved id up first**. A `409`, a timeout, a network error or a
   5xx is also followed by a look-up. The event counts as ours only if its private properties carry
   `byppApp=bypp` and `byppEventId=<local id>`; a foreign event → `FAILED id_conflict` (never adopted, never a
   new id); ours but cancelled → `FAILED remote_deleted`.
5. Transient failures: at most 3 inserts (1 s, 3 s back-off). `401`: one forced refresh for the whole
   operation. If even the look-up fails → `UNCERTAIN`, and the next attempt verifies before sending.
6. Crash or a failed local write after a remote success: the lease expires and step 4 adopts the event.
7. `sent_hash` records what was sent, so the UI can say "created on Google" vs "edited locally since".
   `account_sub` + `target_calendar_id` record *which* primary calendar; attempts are never continued under a
   different account.

## Bulk send (`/calendar/google`)

Still explicit and per event — just many of them at once, chosen by the user.

- `planBulkSend()` (`bulk-plan.ts`) sorts every local event, from the local database only, into **sendable**
  (never sent, or an earlier attempt failed / is unresolved), **created**, **blocked** (notice, undated, no end
  time, bad interval — with the reason) and **sending** (live lease). Rendering the page calls Google zero
  times and writes nothing. An optional schedule-date range narrows the list (undated events then drop out).
- The page lists the sendable events grouped by month with checkboxes (all ticked by default; month-level and
  global tick/untick). Events sharing a slot (same start + category) carry a badge so repeated notices can be
  unticked. Exclusions apply to that send only and are not stored.
- After a second confirmation (account, count, "cannot be undone from BYPP"), the client walks through the
  ticked ids and calls the server action `sendEventsToGoogle(ids)` with **3 ids per call**. The action accepts
  ids only (max 10, validated), and `sendMany()` (`bulk-send.ts`) calls the very same `createGoogleEvent()`
  for each — so the deterministic id, the DB claim and look-before-resend apply unchanged. Sending the same
  list twice, or from two tabs, creates nothing twice; an unticked id is never part of any request.
- Stopping rules: `needs-reconnect` / `not-connected` → stop at once, the rest is reported as unsent;
  `rate_limited` → stop, the client waits 60 s and carries on (at most 5 fruitless waits); any other failure
  affects that event only. The user can pause between calls; finished events stay `SYNCED`, so reopening the
  page simply offers what is left.

### Scope: important only (default)

- `/calendar/google` opens on `?scope=important`; `?scope=all` is the whole calendar. Any other value is
  refused (nothing listed, nothing sendable) — it never widens to "all".
- `planBulkSend(db, now, range, scope)` filters by `calendarEventsRepo.importantIds()` — the same SQL predicate
  the lists use (override, else a keyword in the event's **current** title). The tab counts `[★ 중요만 N]
  [전체 M]` are **sendable** counts, not "all important events": already-created, blocked and in-flight events
  are not counted; the breakdown line shows them.
- `sendEventsToGoogle(ids, scope)` validates the scope with zod, and `sendMany(deps, ids, { scope })` re-checks
  `isImportant(id)` right before each create. An event that stopped being important since the page was shown
  is reported as `skipped` ("건너뜀: 중요 아님") and costs **no** Google request.
- Importance only chooses what may be sent **new**. When an event stops being important after it was sent,
  nothing happens on Google: no delete, no unsync, and its `calendar_syncs` row (external id, history) stays.

## Later edits and deletes

- Editing a created event does **not** update Google; the UI says so. Nothing re-creates an event.
- Deleting locally (remove from calendar, ignore / back-to-pending on the candidate, bulk actions, repair)
  does **not** delete on Google; the confirmation texts say so. `calendar_syncs` uses `ON DELETE CASCADE`, so
  the local history goes with the local event. Consequence: remove → re-approve creates a *new* local event,
  and sending that one creates a second Google event. Nothing is merged by title/date/candidate.
- While a request is in flight (live lease) every delete path is blocked by one guard in the calendar-events
  repository (`EventSyncInProgressError`); the surrounding transaction rolls back and the UI shows a notice.

## Not in this milestone

Two-way sync, import from Google, webhooks, background sync, UPDATE/DELETE on Google, UPDATE/CANCEL notice
reconciliation, other providers, multiple accounts, calendar picker, attendees, recurrence, conference links,
disconnect/revoke UI (revoke at <https://myaccount.google.com/permissions>).

## Manual smoke test (not automated — it touches a real account)

1. Google Cloud Console: enable **Google Calendar API**; OAuth consent screen in *Testing* with your account as
   a test user; OAuth client of type *Web application* whose authorised redirect URI equals
   `GOOGLE_REDIRECT_URI` exactly.
2. `npm run dev` → `/calendar` → **Google 연결** → consent (keep the calendar permission ticked) → the card shows
   "연결됨 · your email". Nothing has been sent.
3. Open an event that has a start and an end → **Google에 일정 생성** → "Google에 생성됨" + time; check Google
   Calendar: same title/time/place, no description, no guests.
4. Press nothing twice: the button is gone. Edit the event locally → "로컬에서 수정 … 반영되지 않았습니다".
5. A 변경/취소 공지 shows why it cannot be sent. An event with a start but no end time can be sent: the panel
   says "종료 시각 미입력 · Google에는 시작 후 1시간 일정으로 생성됩니다."; on Google it is a one-hour event, and
   BYPP still shows it without an end.
6. Restart the dev server → still connected.

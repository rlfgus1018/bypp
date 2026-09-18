import type { CalendarEvent } from "@/lib/calendar/types";
import type { Db } from "@/lib/db/client";
import { calendarSyncsRepo } from "@/lib/db/repositories/calendar-syncs";
import type { ConnectionView } from "./connection";
import { NOT_SYNCABLE_TEXT, toGoogleEvent } from "./event-mapper";
import type { SyncErrorCode } from "./sync-service";

// What the UI shows about one event's Google state. Built only from the local DB — rendering never calls
// Google — and made only of safe, display-ready values (no tokens, no ids of the account).

export type SyncView = {
  state: "not-sent" | "sending" | "created" | "failed" | "uncertain";
  /** ISO, for "created" */
  syncedAt: string | null;
  /** "created", but the local event was edited afterwards: Google still has the old values */
  editedSince: boolean;
  /** why the last attempt failed (safe Korean text) */
  problem: string | null;
  /** why the button is unavailable right now; null = the user may press it */
  blockedBy: string | null;
  canSend: boolean;
  buttonLabel: string;
};

const ERROR_TEXT: Record<SyncErrorCode | "unknown_outcome", string> = {
  id_conflict: "같은 ID의 다른 일정이 Google 캘린더에 이미 있어 생성하지 못했습니다. (다른 일정을 덮어쓰거나 새 ID로 다시 만들지 않습니다.)",
  remote_deleted: "이 일정은 Google 캘린더에서 삭제된 것으로 보입니다. 같은 일정을 다시 만들 수 없습니다.",
  rate_limited: "Google API 요청 한도에 걸렸습니다. 잠시 후 다시 시도해 주세요.",
  server: "Google 서버 오류로 생성하지 못했습니다. 잠시 후 다시 시도해 주세요.",
  network: "Google에 연결하지 못했습니다. 네트워크를 확인하고 다시 시도해 주세요.",
  bad_request: "Google이 이 일정의 내용을 거부했습니다. 제목·시간을 확인해 주세요.",
  needs_reconnect: "Google 연결이 만료되었거나 권한이 부족합니다. 다시 연결한 뒤 시도해 주세요.",
  unknown: "알 수 없는 오류로 생성하지 못했습니다.",
  unknown_outcome: "요청은 보냈지만 결과를 확인하지 못했습니다. 다시 시도하면 먼저 Google에 이미 만들어졌는지 확인합니다.",
};

export const syncErrorText = (code: string | null) => (code && code in ERROR_TEXT ? ERROR_TEXT[code as keyof typeof ERROR_TEXT] : code ? ERROR_TEXT.unknown : null);

const CONNECTION_BLOCK: Record<Exclude<ConnectionView["state"], "connected">, string> = {
  "not-configured": "Google 연동 설정이 완료되지 않았습니다.",
  "not-connected": "먼저 위에서 Google 계정을 연결해 주세요.",
  "needs-reconnect": "Google 계정을 다시 연결해야 합니다.",
};

export function getSyncView(db: Db, event: CalendarEvent, connection: ConnectionView, nowMs: number): SyncView {
  const sync = calendarSyncsRepo(db).find(event.id);
  const mapped = toGoogleEvent(event);
  const base = { syncedAt: null, editedSince: false, problem: null, blockedBy: null, canSend: false, buttonLabel: "Google에 일정 생성" };

  if (sync?.status === "SYNCED") {
    // Created once; later local edits are deliberately NOT pushed (no UPDATE in this milestone).
    const editedSince = !mapped.ok || mapped.hash !== sync.sentHash;
    return { ...base, state: "created", syncedAt: sync.syncedAt, editedSince };
  }
  const leaseActive = sync?.status === "SYNCING" && sync.leaseExpiresAt !== null && Date.parse(sync.leaseExpiresAt) > nowMs;
  if (leaseActive) return { ...base, state: "sending", blockedBy: "Google로 전송하는 중입니다." };

  const state: SyncView["state"] = sync?.status === "UNCERTAIN" || sync?.status === "SYNCING" ? "uncertain" : sync?.status === "FAILED" ? "failed" : "not-sent";
  const problem = state === "uncertain" ? ERROR_TEXT.unknown_outcome : state === "failed" ? syncErrorText(sync?.lastError ?? null) : null;
  const blockedBy = !mapped.ok ? NOT_SYNCABLE_TEXT[mapped.reason] : connection.state !== "connected" ? CONNECTION_BLOCK[connection.state] : null;
  return { ...base, state, problem, blockedBy, canSend: blockedBy === null, buttonLabel: state === "not-sent" ? "Google에 일정 생성" : "다시 시도 (중복 생성 없이)" };
}

/** Light per-event marks for the month view, from one query. */
export function getSyncMarks(db: Db): Map<string, "created" | "failed"> {
  const marks = new Map<string, "created" | "failed">();
  for (const [eventId, { status }] of calendarSyncsRepo(db).statusByEvent()) {
    if (status === "SYNCED") marks.set(eventId, "created");
    else if (status === "FAILED" || status === "UNCERTAIN") marks.set(eventId, "failed");
  }
  return marks;
}

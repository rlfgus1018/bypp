import { beforeEach, describe, expect, it } from "vitest";
import { fixtureBytes } from "../../../tests/helpers/fixtures";
import { createDb, type Db } from "@/lib/db/client";
import { calendarEventsRepo } from "@/lib/db/repositories/calendar-events";
import { candidatesRepo } from "@/lib/db/repositories/candidates";
import { extractPendingBatch } from "@/lib/pipeline/extract";
import { ingestKakaoExport } from "@/lib/pipeline/ingest";
import { HeuristicExtractor } from "@/lib/schedule/heuristic-extractor";
import { HybridExtractor } from "@/lib/schedule/hybrid-extractor";
import { applyCandidateStatus, reconcileCalendar, removeEventFromCalendar } from "./candidate-event-link";
import { parseEventInput, toFormValues, type EventFormValues } from "./event-input";

const kst = (day: string, time = "00:00") => `${day}T${time}:00+09:00`;
const form = (overrides: Partial<EventFormValues> = {}): EventFormValues => ({
  title: "동아리 회의",
  location: "",
  allDay: false,
  startDate: "2026-09-24",
  startTime: "19:00",
  endDate: "",
  endTime: "",
  ...overrides,
});
const snapshot = (db: Db) => JSON.stringify(candidatesRepo(db).listWithSource().map((c) => [c.id, c.status, c.title, c.category, c.statusChangedAt]));

let db: Db;
beforeEach(async () => {
  db = createDb(":memory:");
  await ingestKakaoExport(db, { bytes: fixtureBytes("schedules.txt"), filename: "schedules.txt" });
  await extractPendingBatch(db, new HybridExtractor(new HeuristicExtractor()), 100);
});

describe("category in the event form", () => {
  it("is validated when given, and left alone when the form has no category field", () => {
    expect(parseEventInput(form({ category: "MEETING" }))).toMatchObject({ ok: true, changes: { category: "MEETING" } });
    expect(parseEventInput(form({ category: "PARTY" }))).toEqual({ ok: false, errors: ["분류가 올바르지 않습니다."] });
    const withoutField = parseEventInput(form());
    expect(withoutField.ok && "category" in withoutField.changes).toBe(false);
    expect(toFormValues({ title: "t", location: null, startAt: kst("2026-09-24", "19:00"), endAt: null, allDay: false, category: "DEADLINE" }).category).toBe("DEADLINE");
  });

  it("editing the category changes the event only — the candidate keeps what was extracted", () => {
    const candidate = candidatesRepo(db).listWithSource()[0];
    applyCandidateStatus(db, candidate.id, "APPROVED");
    const events = calendarEventsRepo(db);
    const event = events.findByCandidateId(candidate.id)!;
    const before = snapshot(db);
    const parsed = parseEventInput(form({ title: event.title, category: "UNKNOWN" }));
    if (!parsed.ok) throw new Error(parsed.errors.join());
    events.update(event.id, parsed.changes);
    expect(events.findById(event.id)?.category).toBe("UNKNOWN");
    expect(snapshot(db)).toBe(before);

    const keep = parseEventInput(form({ title: "다시 고침" }));
    if (!keep.ok) throw new Error(keep.errors.join());
    events.update(event.id, keep.changes); // no category in the form → unchanged
    expect(events.findById(event.id)).toMatchObject({ title: "다시 고침", category: "UNKNOWN" });
  });
});

describe("events added directly on the calendar", () => {
  it("have no candidate, are never 'repaired', and are removed without touching any candidate", () => {
    const events = calendarEventsRepo(db);
    const parsed = parseEventInput(form({ category: "MEETING" }));
    if (!parsed.ok) throw new Error(parsed.errors.join());
    const id = events.createManual({ ...parsed.changes, category: parsed.changes.category ?? "EVENT" });
    expect(events.findById(id)).toMatchObject({ candidateId: null, origin: "MANUAL", kind: "EVENT", category: "MEETING", title: "동아리 회의", startAt: kst("2026-09-24", "19:00"), endAt: null });

    expect(reconcileCalendar(db)).toMatchObject({ missingEvents: [], staleEvents: [], orphanedEvents: [] });
    reconcileCalendar(db, { apply: true });
    expect(events.findById(id)).not.toBeNull();

    const before = snapshot(db);
    expect(removeEventFromCalendar(db, id)).toBe(true);
    expect(events.findById(id)).toBeNull();
    expect(snapshot(db)).toBe(before);
  });
});

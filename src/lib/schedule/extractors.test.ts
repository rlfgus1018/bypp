import { describe, expect, it } from "vitest";
import { fixtureText } from "../../../tests/helpers/fixtures";
import { MockLlmClient } from "@/lib/ai/mock-llm-client";
import { LlmScheduleExtractor } from "@/lib/ai/llm-schedule-extractor";
import { parseKakaoExport } from "@/lib/kakao-export/parser";
import { HeuristicExtractor } from "./heuristic-extractor";
import { HybridExtractor } from "./hybrid-extractor";
import { extractByRules } from "./rule-extractor";
import { ScheduleExtractionResultSchema } from "./schemas";
import type { ExtractionInput } from "./types";

const schedules = parseKakaoExport(fixtureText("schedules.txt")).messages;
const basic = parseKakaoExport(fixtureText("basic.txt")).messages;
const input = (m: { sentAt: string; sender: string; text: string }): ExtractionInput => ({ message: m, referenceTime: m.sentAt });
const byStart = (text: string) => schedules.find((m) => m.text.startsWith(text))!;

describe("extractByRules", () => {
  it("explicit event: date, time and location from labeled fields", () => {
    const result = extractByRules(input(byStart("[ 합동응원OT")));
    expect(result.needsFallback).toBe(false);
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]).toMatchObject({
      action: "CREATE",
      title: "합동응원OT 안내",
      startAt: "2026-09-22T18:00:00+09:00",
      endAt: null,
      allDay: false,
      location: "테스트대학교 노천극장",
      category: "EVENT",
    });
    expect(result.candidates[0].confidence).toBeGreaterThanOrEqual(0.85);
  });

  it("multiple dates in one message → an event candidate and a deadline candidate", () => {
    const result = extractByRules(input(basic[2]));
    expect(result.candidates.map((c) => c.category)).toEqual(["EVENT", "DEADLINE"]);
    expect(result.candidates[0]).toMatchObject({
      startAt: "2026-03-10T12:00:00+09:00",
      endAt: "2026-03-10T13:00:00+09:00",
      location: "테스트관 101호",
    });
    expect(result.candidates[1]).toMatchObject({
      title: "테스트 간담회 안내 (설문 참여 기한)",
      startAt: "2026-03-05T13:00:00+09:00",
      endAt: null,
      location: null,
    });
  });

  it("date range → PERIOD, plus the event itself", () => {
    const result = extractByRules(input(byStart("[ 멘토링")));
    expect(result.candidates.map((c) => c.category)).toEqual(["PERIOD", "EVENT"]);
    expect(result.candidates[0]).toMatchObject({
      startAt: "2026-09-10T00:00:00+09:00",
      endAt: "2026-09-13T23:59:00+09:00",
      allDay: true,
    });
    expect(result.candidates[1].startAt).toBe("2026-09-22T18:00:00+09:00");
  });

  it("a meeting title makes it a MEETING; the year comes from the message time", () => {
    const [meeting] = extractByRules(input(byStart("[ 제3차"))).candidates;
    expect(meeting).toMatchObject({ category: "MEETING", startAt: "2026-09-14T21:00:00+09:00" });
  });

  it("joins a date field and a separate time field", () => {
    const text = "[ 특강 ]\n날짜: 9/22\n시간: 18:00 ~ 19:30\n장소: 추후 안내 예정";
    const [c] = extractByRules(input({ sentAt: "2026-09-11T10:00:00+09:00", sender: "x", text })).candidates;
    expect(c).toMatchObject({
      startAt: "2026-09-22T18:00:00+09:00",
      endAt: "2026-09-22T19:30:00+09:00",
      allDay: false,
      location: null,
    });
  });

  it.each([
    ["설문은 금일", "no-labeled-absolute-date"],
    ["회의 시간을 금요일", "change-notice"],
    ["지난 9월 20일", "change-notice"],
    ["내일 세미나는 취소", "change-notice"],
    ["넵 확인했습니다", "no-labeled-absolute-date"],
  ])("sends ambiguous message to the fallback: %s", (start, reason) => {
    const result = extractByRules(input(byStart(start)));
    expect(result.needsFallback).toBe(true);
    expect(result.reason).toBe(reason);
  });

  it("does not treat boilerplate like '변경될 수 있습니다' as a change notice", () => {
    const text = "[ OT ]\n일시: 9/22 18:00\n※ 일정은 변경될 수 있습니다. 취소 시 연락 바랍니다.";
    expect(extractByRules(input({ sentAt: "2026-09-11T10:00:00+09:00", sender: "x", text })).needsFallback).toBe(false);
  });

  it("always produces schema-valid output", () => {
    for (const message of [...schedules, ...basic]) {
      const { candidates } = extractByRules(input(message));
      expect(ScheduleExtractionResultSchema.safeParse({ candidates }).success).toBe(true);
    }
  });
});

describe("HeuristicExtractor", () => {
  const heuristic = new HeuristicExtractor();

  it("relative date: 금일 resolves against the message time, with low confidence", async () => {
    const { candidates, extractor } = await heuristic.extract(input(byStart("설문은 금일")));
    expect(extractor).toBe("heuristic");
    expect(candidates[0]).toMatchObject({
      action: "CREATE",
      category: "DEADLINE",
      startAt: "2026-09-11T18:00:00+09:00",
    });
    expect(candidates[0].confidence).toBeLessThanOrEqual(0.5);
  });

  it("update-like message → UPDATE with the new (last) date", async () => {
    const { candidates } = await heuristic.extract(input(byStart("지난 9월 20일")));
    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({ action: "UPDATE", startAt: "2026-09-27T00:00:00+09:00", allDay: true });
  });

  it("cancellation → CANCEL", async () => {
    const { candidates } = await heuristic.extract(input(byStart("내일 세미나는 취소")));
    expect(candidates[0]).toMatchObject({ action: "CANCEL", startAt: "2026-09-12T00:00:00+09:00" });
  });

  it("a change notice with only times is still surfaced, without inventing a date", async () => {
    const text = "[ 시간 변동 안내 ]\n기존 시간: 22:00\n변동된 시간: 00:00 ~ 01:00 사이 무작위";
    const { candidates } = await heuristic.extract(input({ sentAt: "2026-09-11T10:00:00+09:00", sender: "x", text }));
    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({ action: "UPDATE", startAt: null, confidence: 0.3 });
  });

  it("non-schedule message → no candidates", async () => {
    expect((await heuristic.extract(input(byStart("넵 확인했습니다")))).candidates).toEqual([]);
  });
});

describe("HybridExtractor routing", () => {
  it("clear schedules never reach the LLM; only ambiguous ones do", async () => {
    const llm = new MockLlmClient([{ candidates: [] }]);
    const hybrid = new HybridExtractor(new LlmScheduleExtractor(llm));
    const outcomes = [];
    for (const message of schedules) outcomes.push(await hybrid.extract(input(message)));

    const ruleHandled = outcomes.filter((o) => o.extractor === "rule").length;
    expect(ruleHandled).toBe(3); // OT, 멘토링, 운영위
    expect(llm.calls).toHaveLength(schedules.length - ruleHandled);
    const sent = llm.calls.map((c) => c.prompt).join("\n");
    expect(sent).toContain("금일 오후 6시");
    expect(sent).toContain("연장합니다");
    expect(sent).not.toContain("합동응원OT");
    expect(sent).not.toContain("운영위원회");
  });
});

import { describe, expect, it } from "vitest";
import { findDateMentions, findTimeMentions, resolveSpan, resolveYear } from "./datetime";
import { toIsoKst, type KstDate } from "./kst";

const REF: KstDate = { y: 2026, m: 9, d: 11 }; // Friday

const dates = (text: string, includeRelative = false) =>
  findDateMentions(text, REF, { includeRelative }).map((d) => toIsoKst(d.date).slice(0, 10));
const times = (text: string) => findTimeMentions(text).map((t) => `${t.time.hh}:${String(t.time.mm).padStart(2, "0")}`);

describe("findDateMentions", () => {
  it.each([
    ["2026년 9월 22일 화요일", ["2026-09-22"]],
    ["2026. 09. 22. (화) 18:00", ["2026-09-22"]],
    ["2026-09-22", ["2026-09-22"]],
    ["9월 22일", ["2026-09-22"]],
    ["9/22 18:00", ["2026-09-22"]],
    ["신청 기간: 9/10 ~ 9/13", ["2026-09-10", "2026-09-13"]],
    ["9.22(화) 진행", ["2026-09-22"]],
    ["평점 3.5 이상", []],
    ["13월 40일", []],
    ["비율은 3 : 2", []],
  ])("%s", (text, expected) => {
    expect(dates(text)).toEqual(expected);
  });

  it("does not read one full date as two", () => {
    expect(findDateMentions("2026년 9월 22일", REF)).toHaveLength(1);
  });

  it("infers the year closest to the message date", () => {
    expect(resolveYear(1, 5, { y: 2026, m: 12, d: 20 })).toEqual({ y: 2027, m: 1, d: 5 });
    expect(resolveYear(12, 28, { y: 2027, m: 1, d: 3 })).toEqual({ y: 2026, m: 12, d: 28 });
    expect(resolveYear(4, 20, { y: 2026, m: 4, d: 25 })).toEqual({ y: 2026, m: 4, d: 20 });
  });

  it("resolves relative expressions against the reference date only when asked", () => {
    expect(dates("금일 오후 6시에 마감")).toEqual([]);
    expect(dates("금일 오후 6시에 마감", true)).toEqual(["2026-09-11"]);
    expect(dates("내일 세미나", true)).toEqual(["2026-09-12"]);
    expect(dates("모레까지", true)).toEqual(["2026-09-13"]);
    expect(dates("다음주 화요일 6시", true)).toEqual(["2026-09-15"]);
    expect(dates("이번주 일요일", true)).toEqual(["2026-09-13"]);
    expect(dates("월요일에 봅시다", true)).toEqual(["2026-09-14"]);
  });

  it("treats a weekday right after an absolute date as an annotation, not a second date", () => {
    expect(dates("9월 14일 월요일 21:00", true)).toEqual(["2026-09-14"]);
  });
});

describe("findTimeMentions", () => {
  it.each([
    ["18:00", ["18:00"]],
    ["오후 6시", ["18:00"]],
    ["오전 12시", ["0:00"]],
    ["오후 12시 30분", ["12:30"]],
    ["12시~13시", ["12:00", "13:00"]],
    ["13시까지", ["13:00"]],
    ["7시 반", ["19:30"]],
    ["00:00 ~ 01:00", ["0:00", "1:00"]],
    ["2시간 동안", []],
    ["2026. 09. 22.", []],
  ])("%s", (text, expected) => {
    expect(times(text)).toEqual(expected);
  });

  it("flags an assumed PM reading", () => {
    expect(findTimeMentions("7시에 만나요")[0].assumedPm).toBe(true);
    expect(findTimeMentions("오전 7시")[0].assumedPm).toBe(false);
  });
});

describe("resolveSpan", () => {
  const span = (text: string) => resolveSpan(findDateMentions(text, REF), findTimeMentions(text));

  it("one date, two times → same-day range", () => {
    const s = span("2026년 3월 10일 화요일 12시~13시")!;
    expect(s.start.time).toEqual({ hh: 12, mm: 0 });
    expect(s.end).toEqual({ date: { y: 2026, m: 3, d: 10 }, time: { hh: 13, mm: 0 } });
  });

  it("carries 오후 over to the second time", () => {
    expect(span("9/22 오후 6시~8시")!.end!.time).toEqual({ hh: 20, mm: 0 });
  });

  it("rolls an earlier end time to the next day", () => {
    expect(span("9/22 23:00 ~ 01:00")!.end!.date).toEqual({ y: 2026, m: 9, d: 23 });
  });

  it("two dates → date range with times attached to the date they follow", () => {
    const s = span("9/10 10:00 ~ 9/13 18:00")!;
    expect(s.start).toEqual({ date: { y: 2026, m: 9, d: 10 }, time: { hh: 10, mm: 0 } });
    expect(s.end).toEqual({ date: { y: 2026, m: 9, d: 13 }, time: { hh: 18, mm: 0 } });
  });

  it("a range crossing new year ends in the next year", () => {
    const s = resolveSpan(findDateMentions("12/28 ~ 1/3", { y: 2026, m: 12, d: 20 }), [])!;
    expect(s.end!.date).toEqual({ y: 2027, m: 1, d: 3 });
  });
});

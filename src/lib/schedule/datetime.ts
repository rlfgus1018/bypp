import { addDays, daysBetween, isValidDate, weekdayOf, type KstDate, type KstTime } from "./kst";

// Korean date/time expression finder. Pure functions; "today" is always passed in
// as `ref` (the message's sent date), never read from the clock.

export type DateMention = {
  index: number;
  end: number;
  raw: string;
  date: KstDate;
  yearInferred: boolean;
  relative: boolean;
};

export type TimeMention = {
  index: number;
  end: number;
  raw: string;
  time: KstTime;
  hasMeridiem: boolean;
  /** "6시" with no 오전/오후 was read as 18:00 */
  assumedPm: boolean;
};

const WEEKDAY_INDEX: Record<string, number> = { 일: 0, 월: 1, 화: 2, 수: 3, 목: 4, 금: 5, 토: 6 };

/** A date without a year belongs to the year that puts it closest to the message (±~6 months). */
export function resolveYear(month: number, day: number, ref: KstDate): KstDate {
  const candidate = { y: ref.y, m: month, d: day };
  const diff = daysBetween(ref, candidate);
  if (diff < -183) return { ...candidate, y: ref.y + 1 };
  if (diff > 183) return { ...candidate, y: ref.y - 1 };
  return candidate;
}

type AbsolutePattern = {
  regex: RegExp;
  read: (m: RegExpExecArray) => { y?: number; m: number; d: number };
};

const ABSOLUTE_PATTERNS: AbsolutePattern[] = [
  {
    regex: /(\d{4})\s*년\s*(\d{1,2})\s*월\s*(\d{1,2})\s*일/g,
    read: (m) => ({ y: +m[1], m: +m[2], d: +m[3] }),
  },
  {
    regex: /(?<!\d)(\d{4})\s*[.\-/]\s*(\d{1,2})\s*[.\-/]\s*(\d{1,2})(?!\d)\.?/g,
    read: (m) => ({ y: +m[1], m: +m[2], d: +m[3] }),
  },
  {
    regex: /(?<!\d)(\d{1,2})\s*월\s*(\d{1,2})\s*일/g,
    read: (m) => ({ m: +m[1], d: +m[2] }),
  },
  {
    // 9/22, ~9/29  (not 2025/9/22, not 1/2/3)
    regex: /(?<![\d/.])(\d{1,2})\s?\/\s?(\d{1,2})(?![\d/])/g,
    read: (m) => ({ m: +m[1], d: +m[2] }),
  },
  {
    // 9.22(화) — only with a weekday, otherwise "3.5" style numbers would match
    regex: /(?<![\d.])(\d{1,2})\.\s?(\d{1,2})\.?(?=\s*\([월화수목금토일]\))/g,
    read: (m) => ({ m: +m[1], d: +m[2] }),
  },
];

const RELATIVE_DAY = /(오늘|금일|내일|명일|익일|모레)/g;
const RELATIVE_DAY_OFFSET: Record<string, number> = { 오늘: 0, 금일: 0, 내일: 1, 명일: 1, 익일: 1, 모레: 2 };
const RELATIVE_WEEKDAY = /(?:(다음\s*주|차주|이번\s*주|금주)\s*)?([월화수목금토일])요일/g;

function overlaps(taken: [number, number][], start: number, end: number): boolean {
  return taken.some(([s, e]) => start < e && end > s);
}

export function findDateMentions(text: string, ref: KstDate, options: { includeRelative?: boolean } = {}): DateMention[] {
  const mentions: DateMention[] = [];
  const taken: [number, number][] = [];

  for (const pattern of ABSOLUTE_PATTERNS) {
    pattern.regex.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = pattern.regex.exec(text))) {
      const start = m.index;
      const end = start + m[0].length;
      if (overlaps(taken, start, end)) continue;
      const parts = pattern.read(m);
      const date = parts.y ? { y: parts.y, m: parts.m, d: parts.d } : resolveYear(parts.m, parts.d, ref);
      if (!isValidDate(date)) continue;
      taken.push([start, end]);
      mentions.push({ index: start, end, raw: m[0], date, yearInferred: !parts.y, relative: false });
    }
  }

  if (options.includeRelative) {
    let m: RegExpExecArray | null;
    RELATIVE_DAY.lastIndex = 0;
    while ((m = RELATIVE_DAY.exec(text))) {
      const end = m.index + m[0].length;
      if (overlaps(taken, m.index, end)) continue;
      taken.push([m.index, end]);
      mentions.push({
        index: m.index,
        end,
        raw: m[0],
        date: addDays(ref, RELATIVE_DAY_OFFSET[m[1]]),
        yearInferred: false,
        relative: true,
      });
    }

    RELATIVE_WEEKDAY.lastIndex = 0;
    while ((m = RELATIVE_WEEKDAY.exec(text))) {
      const start = m.index;
      const end = start + m[0].length;
      if (overlaps(taken, start, end)) continue;
      // "9월 22일 화요일": the weekday only annotates the absolute date before it.
      const annotatesDate = mentions.some((d) => !d.relative && start >= d.end && start - d.end <= 3);
      if (annotatesDate) continue;
      const target = WEEKDAY_INDEX[m[2]];
      const refWeekday = weekdayOf(ref);
      const mondayBased = (n: number) => (n + 6) % 7;
      const qualifier = m[1]?.replace(/\s/g, "");
      let offset: number;
      if (qualifier === "다음주" || qualifier === "차주") offset = mondayBased(target) - mondayBased(refWeekday) + 7;
      else if (qualifier === "이번주" || qualifier === "금주") offset = mondayBased(target) - mondayBased(refWeekday);
      else offset = (target - refWeekday + 7) % 7;
      taken.push([start, end]);
      mentions.push({ index: start, end, raw: m[0], date: addDays(ref, offset), yearInferred: false, relative: true });
    }
  }

  return mentions.sort((a, b) => a.index - b.index);
}

const MERIDIEM = "오전|오후|아침|새벽|낮|저녁|밤";
const TIME_COLON = new RegExp(`(?:(${MERIDIEM})\\s*)?(?<![\\d:])(\\d{1,2}):(\\d{2})(?![\\d:])`, "g");
const TIME_KOREAN = new RegExp(`(?:(${MERIDIEM})\\s*)?(?<!\\d)(\\d{1,2})\\s*시(?!간)(?:\\s*(\\d{1,2})\\s*분|\\s*(반))?`, "g");
const PM_WORDS = new Set(["오후", "낮", "저녁", "밤"]);

function applyMeridiem(hour: number, meridiem: string | undefined): number | null {
  if (hour > 24) return null;
  if (!meridiem) return hour === 24 ? 0 : hour;
  if (hour > 12) return hour === 24 ? 0 : hour;
  if (PM_WORDS.has(meridiem)) return hour === 12 ? 12 : hour + 12;
  return hour === 12 ? 0 : hour;
}

export function findTimeMentions(text: string): TimeMention[] {
  const mentions: TimeMention[] = [];
  const taken: [number, number][] = [];

  const collect = (regex: RegExp, korean: boolean) => {
    regex.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = regex.exec(text))) {
      const start = m.index;
      const end = start + m[0].length;
      if (overlaps(taken, start, end)) continue;
      const meridiem = m[1];
      const rawHour = +m[2];
      const minute = korean ? (m[4] ? 30 : m[3] ? +m[3] : 0) : +m[3];
      let hour = applyMeridiem(rawHour, meridiem);
      if (hour === null || minute > 59) continue;
      let assumedPm = false;
      if (korean && !meridiem && rawHour >= 1 && rawHour <= 7) {
        hour = rawHour + 12;
        assumedPm = true;
      }
      taken.push([start, end]);
      mentions.push({ index: start, end, raw: m[0], time: { hh: hour, mm: minute }, hasMeridiem: !!meridiem, assumedPm });
    }
  };

  collect(TIME_COLON, false);
  collect(TIME_KOREAN, true);
  return mentions.sort((a, b) => a.index - b.index);
}

export type ResolvedSpan = {
  start: { date: KstDate; time: KstTime | null };
  end: { date: KstDate; time: KstTime | null } | null;
  assumedPm: boolean;
  yearInferred: boolean;
};

/**
 * Combines the dates and times found on one line into a start/end pair.
 *   1 date, 2 times → same-day range (end rolls to the next day if it is earlier)
 *   2 dates         → date range; times attach to the date they follow
 */
export function resolveSpan(dates: DateMention[], times: TimeMention[]): ResolvedSpan | null {
  if (dates.length === 0) return null;
  const [d1, d2] = dates;
  const flags = {
    assumedPm: times.slice(0, 2).some((t) => t.assumedPm),
    yearInferred: dates.slice(0, 2).some((d) => d.yearInferred),
  };

  if (!d2) {
    const [t1, t2raw] = times;
    if (!t1) return { start: { date: d1.date, time: null }, end: null, ...flags };
    if (!t2raw) return { start: { date: d1.date, time: t1.time }, end: null, ...flags };
    let t2 = t2raw.time;
    // "오후 6시~8시": the meridiem carries over to the second time
    if (!t2raw.hasMeridiem && t1.time.hh >= 12 && t2.hh < 12 && t2.hh + 12 > t1.time.hh) t2 = { ...t2, hh: t2.hh + 12 };
    const endsNextDay = t2.hh * 60 + t2.mm < t1.time.hh * 60 + t1.time.mm;
    return {
      start: { date: d1.date, time: t1.time },
      end: { date: endsNextDay ? addDays(d1.date, 1) : d1.date, time: t2 },
      ...flags,
    };
  }

  // A range like "12/28 ~ 1/3" crosses the year boundary.
  let endDate = d2.date;
  if (d2.yearInferred && daysBetween(d1.date, endDate) < 0) endDate = { ...endDate, y: endDate.y + 1 };

  const startTime = times.find((t) => t.index >= d1.end && t.index < d2.index) ?? null;
  const endTime = times.find((t) => t.index >= d2.end) ?? null;
  return {
    start: { date: d1.date, time: startTime?.time ?? null },
    end: { date: endDate, time: endTime?.time ?? null },
    ...flags,
  };
}

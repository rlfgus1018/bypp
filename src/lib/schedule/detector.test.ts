import { describe, expect, it } from "vitest";
import { detectScheduleSignals } from "./detector";

describe("detectScheduleSignals", () => {
  it.each([
    "📍 일시: 2026. 09. 22. (화) 18:00\n📍 장소: 노천극장",
    "신청 기간: 9/10 ~ 9/13",
    "설문은 금일 오후 6시에 마감됩니다.",
    "회의 시간을 금요일 7시로 변경합니다.",
    "9월 27일까지로 연장합니다.",
    "내일 세미나는 취소되었습니다.",
    "다음주 중에 설명회 다시 진행하겠습니다.",
    "공모전 접수 안내드립니다",
  ])("detects: %s", (text) => {
    expect(detectScheduleSignals(text).isCandidate).toBe(true);
  });

  it.each(["넵 확인했습니다 감사합니다", "통합공지방 전달 바랍니다", "ㅋㅋㅋㅋ", "내일 봐요", "비율은 3 : 2 입니다"])(
    "skips: %s",
    (text) => {
      expect(detectScheduleSignals(text).isCandidate).toBe(false);
    },
  );

  it("reports which signals fired", () => {
    const { signals } = detectScheduleSignals("📌 일시 : 2026년 4월 10일 12시~13시\n📌 설문 참여 기한 4월 1일 13시까지");
    expect(signals.dates).toHaveLength(2);
    expect(signals.times).toContain("13시");
    expect(signals.labeledFields).toEqual(["일시", "설문 참여 기한"]);
    expect(signals.keywords).toEqual(expect.arrayContaining(["일시", "기한", "설문"]));
  });
});

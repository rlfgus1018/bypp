import { describe, expect, it } from "vitest";
import { fixtureText } from "../../../tests/helpers/fixtures";
import { parseKakaoExport } from "./parser";

describe("parseKakaoExport", () => {
  const basic = parseKakaoExport(fixtureText("basic.txt"));

  it("reads the room name from the header and skips header lines", () => {
    expect(basic.roomName).toBe("테스트 학생회 공지방 12");
    expect(basic.messages).toHaveLength(4);
  });

  it("parses a single-line message with sender and KST timestamp", () => {
    expect(basic.messages[1]).toMatchObject({
      sentAt: "2026-03-02T09:05:00+09:00",
      sender: "가나다",
      text: "안녕하세요",
      kind: "TEXT",
    });
  });

  it("converts 오전 12시 to 00 and 오후 12시 to 12", () => {
    expect(basic.messages[0].sentAt).toBe("2026-03-02T00:30:00+09:00");
    expect(basic.messages[2].sentAt).toBe("2026-03-02T12:04:00+09:00");
  });

  it("converts 오후 times", () => {
    expect(basic.messages[3].sentAt).toBe("2026-03-03T16:39:00+09:00");
  });

  it("keeps multiline messages together, preserving inner blank lines", () => {
    const notice = basic.messages[2];
    expect(notice.text.startsWith("[ 테스트 간담회 안내 ]\n\n*행정실")).toBe(true);
    expect(notice.text).toContain("📌 일시 : 2026년 3월 10일 화요일 12시~13시");
    expect(notice.text).toContain("📌 장소 : 테스트관 101호");
    expect(notice.text).toContain("3월 5일 13시까지");
    expect(notice.text.endsWith("게시물 담당자: 학생회장 홍길동")).toBe(true);
    expect(notice.rawText.startsWith("2026년 3월 2일 오후 12:04, 홍길동 : [")).toBe(true);
  });

  it("does not turn date separators into messages", () => {
    expect(basic.stats.dateSeparators).toBe(2);
  });

  it("handles system, deleted and media lines safely", () => {
    const result = parseKakaoExport(fixtureText("system-and-media.txt"));
    expect(result.stats.systemLines).toBe(2);
    expect(result.stats.deletedPlaceholders).toBe(2);
    expect(result.messages.map((m) => m.kind)).toEqual(["PHOTO", "PHOTO", "MEDIA", "MEDIA", "MEDIA", "TEXT"]);
    // the deleted placeholder must not be glued onto the previous message
    expect(result.messages[0].text).toBe("사진 6장");
  });

  it("treats a timestamp-looking line that goes back in time as message body", () => {
    const result = parseKakaoExport(fixtureText("tricky.txt"));
    expect(result.messages).toHaveLength(2);
    expect(result.messages[0].sender).toBe("인지 25 가나다");
    expect(result.messages[0].text).toBe(
      "아래 대화 참고해주세요\n2026년 3월 1일 오전 9:00, 홍길동 : 예전에 했던 말\n끝",
    );
    expect(result.stats.suspiciousContinuations).toHaveLength(1);
  });

  it("splits the sender at the first separator only and handles CRLF", () => {
    const result = parseKakaoExport(fixtureText("tricky.txt"));
    expect(result.messages[1]).toMatchObject({ sender: "홍길동", text: "비율은 3 : 2 입니다   " });
  });

  it("returns no messages for empty input", () => {
    expect(parseKakaoExport("").messages).toEqual([]);
  });
});

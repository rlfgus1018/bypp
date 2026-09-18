import { describe, expect, it } from "vitest";
import { fixtureText } from "../../../tests/helpers/fixtures";
import { parseKakaoExport } from "@/lib/kakao-export/parser";
import { computeFingerprints } from "./fingerprint";

const msg = (text: string, sender = "가나다", sentAt = "2026-03-02T09:05:00+09:00") => ({ sentAt, sender, text });

describe("computeFingerprints", () => {
  it("is deterministic and versioned", () => {
    const a = computeFingerprints([msg("안녕")]);
    const b = computeFingerprints([msg("안녕")]);
    expect(a).toEqual(b);
    expect(a[0]).toMatch(/^v1:[0-9a-f]{64}$/);
  });

  it("ignores CRLF, trailing whitespace, outer blank lines and unicode form", () => {
    const [a] = computeFingerprints([msg("첫 줄\n둘째 줄")]);
    const [b] = computeFingerprints([msg("\n첫 줄  \r\n둘째 줄\n\n".normalize("NFD"), " 가나다 ")]);
    expect(a).toBe(b);
  });

  it("changes when text, sender or time changes", () => {
    const all = computeFingerprints([
      msg("안녕"),
      msg("안녕!"),
      msg("안녕", "홍길동"),
      msg("안녕", "가나다", "2026-03-02T09:06:00+09:00"),
    ]);
    expect(new Set(all).size).toBe(4);
  });

  it("separates identical messages in the same minute, stably across re-parses", () => {
    const first = computeFingerprints(parseKakaoExport(fixtureText("duplicates.txt")).messages);
    const second = computeFingerprints(parseKakaoExport(fixtureText("duplicates.txt")).messages);
    expect(new Set(first).size).toBe(3);
    expect(first).toEqual(second);
  });
});

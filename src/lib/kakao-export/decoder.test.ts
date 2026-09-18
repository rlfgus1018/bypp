import { afterEach, describe, expect, it, vi } from "vitest";
import PostalMime from "postal-mime";
import { fixtureBytes } from "../../../tests/helpers/fixtures";
import { decodeExportFile, ExportDecodeError } from "./decoder";
import { parseKakaoExport } from "./parser";

afterEach(() => vi.restoreAllMocks());

describe("decodeExportFile", () => {
  it("passes plain .txt through and strips the BOM", async () => {
    const withBom = new Uint8Array([0xef, 0xbb, 0xbf, ...fixtureBytes("basic.txt")]);
    const decoded = await decodeExportFile(withBom);
    expect(decoded.container).toBe("kakao-plaintext");
    expect(decoded.text.startsWith("테스트 학생회")).toBe(true);
  });

  it("treats a .eml that is really Kakao plaintext as plaintext and never calls postal-mime", async () => {
    const spy = vi.spyOn(PostalMime, "parse");
    const decoded = await decodeExportFile(fixtureBytes("plaintext-named.eml"));
    expect(decoded.container).toBe("kakao-plaintext");
    expect(spy).not.toHaveBeenCalled();
    // a "From:" line inside a message body does not make it MIME
    expect(parseKakaoExport(decoded.text).messages[0].text).toContain("From: 학생회");
  });

  it("unwraps a real MIME envelope with a base64 attachment", async () => {
    const decoded = await decodeExportFile(fixtureBytes("wrapped-mime.eml"));
    expect(decoded.container).toBe("mime");
    expect(parseKakaoExport(decoded.text).messages).toHaveLength(4);
  });

  it("fails loudly when an email has no Kakao payload", async () => {
    await expect(decodeExportFile(fixtureBytes("not-kakao.eml"))).rejects.toMatchObject({
      code: "NO_KAKAO_PAYLOAD",
    });
  });

  it("fails loudly on unrecognized content", async () => {
    const bytes = new TextEncoder().encode("hello\nworld\n");
    await expect(decodeExportFile(bytes)).rejects.toBeInstanceOf(ExportDecodeError);
  });
});

import PostalMime from "postal-mime";
import { isKakaoHeaderLine, looksLikeKakaoTimestampLine } from "./line-matchers";

export type ExportContainer = "kakao-plaintext" | "mime";

export type DecodedExport = { text: string; container: ExportContainer };

export class ExportDecodeError extends Error {
  constructor(
    public readonly code: "UNRECOGNIZED_EXPORT" | "NO_KAKAO_PAYLOAD",
    message: string,
  ) {
    super(message);
    this.name = "ExportDecodeError";
  }
}

const SNIFF_LINES = 50;
const MIME_HEADER_NAMES = /^(MIME-Version|Content-Type|Received|From|Return-Path|Message-ID|Delivered-To):/im;
const HEADER_FIELD = /^[A-Za-z][A-Za-z0-9-]*:\s?.*$/;

function decodeUtf8(bytes: Uint8Array): string {
  return new TextDecoder("utf-8").decode(bytes).replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
}

export function looksLikeKakaoPlaintext(text: string): boolean {
  const head = text.split("\n", SNIFF_LINES);
  return head.some((line) => isKakaoHeaderLine(line) || looksLikeKakaoTimestampLine(line));
}

/** True only when the file *starts* with an RFC 5322 header block followed by a blank line. */
export function looksLikeMimeEnvelope(text: string): boolean {
  const lines = text.split("\n");
  let headerLines = 0;
  for (const line of lines) {
    if (line === "") break;
    if (HEADER_FIELD.test(line) || (headerLines > 0 && /^[ \t]/.test(line))) headerLines += 1;
    else return false;
  }
  if (headerLines === 0) return false;
  return MIME_HEADER_NAMES.test(lines.slice(0, headerLines).join("\n"));
}

/**
 * File bytes → plain Kakao export text. The file extension is never trusted:
 * a ".eml" export may already be Kakao plaintext, in which case postal-mime is not used.
 */
export async function decodeExportFile(bytes: Uint8Array): Promise<DecodedExport> {
  const text = decodeUtf8(bytes);

  // The envelope test is strict (the file must *start* with a header block), so Kakao
  // plaintext that merely mentions "From:" somewhere in a message is never treated as MIME.
  if (!looksLikeMimeEnvelope(text)) {
    if (looksLikeKakaoPlaintext(text)) return { text, container: "kakao-plaintext" };
    throw new ExportDecodeError("UNRECOGNIZED_EXPORT", "KakaoTalk 대화 내보내기 형식을 인식할 수 없습니다.");
  }

  const email = await PostalMime.parse(bytes);
  const candidates: string[] = [];
  for (const attachment of email.attachments ?? []) {
    const isText =
      attachment.mimeType?.startsWith("text/") || /\.txt$/i.test(attachment.filename ?? "");
    if (!isText) continue;
    const content = attachment.content;
    candidates.push(typeof content === "string" ? content : decodeUtf8(new Uint8Array(content)));
  }
  if (email.text) candidates.push(email.text);

  for (const candidate of candidates) {
    const normalized = candidate.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
    if (looksLikeKakaoPlaintext(normalized)) return { text: normalized, container: "mime" };
  }
  throw new ExportDecodeError("NO_KAKAO_PAYLOAD", "이메일 안에서 KakaoTalk 대화 내용을 찾지 못했습니다.");
}

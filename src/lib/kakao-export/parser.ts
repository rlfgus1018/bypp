import type { NormalizedMessage } from "@/lib/messages/types";
import { classifyMessageText, isDeletedPlaceholder } from "./classify";
import { matchLine, matchRoomTitle } from "./line-matchers";

export type ParsedMessage = NormalizedMessage & { rawText: string; lineNo: number };

export type ParseStats = {
  totalLines: number;
  systemLines: number;
  dateSeparators: number;
  deletedPlaceholders: number;
  headerLines: number;
  /** Lines that looked like a message start but went back in time, so were kept as body text. */
  suspiciousContinuations: { lineNo: number; line: string }[];
};

export type ParseResult = {
  roomName: string | null;
  messages: ParsedMessage[];
  stats: ParseStats;
};

/**
 * Plain Kakao export text → messages. Knows nothing about files, .eml or MIME.
 * Rule: only a timestamp line starts a new message; everything else is body.
 */
export function parseKakaoExport(input: string): ParseResult {
  const lines = input.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n").split("\n");
  const messages: ParsedMessage[] = [];
  const stats: ParseStats = {
    totalLines: lines.length,
    systemLines: 0,
    dateSeparators: 0,
    deletedPlaceholders: 0,
    headerLines: 0,
    suspiciousContinuations: [],
  };

  let roomName: string | null = null;
  let seenFirstTimestamp = false;
  let lastSentAt = "";
  let current: { sentAt: string; sender: string; lines: string[]; rawLines: string[]; lineNo: number } | null = null;

  const flush = () => {
    if (!current) return;
    const body = [...current.lines];
    while (body.length > 0 && body[body.length - 1].trim() === "") body.pop();
    const text = body.join("\n");
    messages.push({
      sentAt: current.sentAt,
      sender: current.sender,
      text,
      kind: classifyMessageText(text),
      rawText: current.rawLines.join("\n").replace(/\n+$/, ""),
      lineNo: current.lineNo,
    });
    current = null;
  };

  lines.forEach((line, index) => {
    const lineNo = index + 1;
    let match = matchLine(line);

    // Export order is chronological. A "timestamp line" that goes back in time is
    // pasted chat content inside a message body, not a new message.
    if (match.type !== "other" && current && match.sentAt < lastSentAt) {
      stats.suspiciousContinuations.push({ lineNo, line: line.slice(0, 120) });
      match = { type: "other" };
    }

    if (match.type === "other") {
      if (!seenFirstTimestamp) {
        stats.headerLines += 1;
        roomName ??= matchRoomTitle(line);
        return;
      }
      if (isDeletedPlaceholder(line)) {
        flush();
        stats.deletedPlaceholders += 1;
        return;
      }
      if (current) {
        current.lines.push(line);
        current.rawLines.push(line);
      }
      return;
    }

    seenFirstTimestamp = true;
    lastSentAt = match.sentAt;
    flush();
    if (match.type === "date") {
      stats.dateSeparators += 1;
    } else if (match.type === "system") {
      stats.systemLines += 1;
    } else {
      current = { sentAt: match.sentAt, sender: match.sender, lines: [match.text], rawLines: [line], lineNo };
    }
  });
  flush();

  return { roomName, messages, stats };
}

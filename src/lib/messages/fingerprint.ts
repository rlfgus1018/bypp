import { createHash } from "node:crypto";
import { normalizeSender, normalizeText } from "./normalize";
import type { NormalizedMessage } from "./types";

const VERSION = "v1";

function baseKey(message: Pick<NormalizedMessage, "sentAt" | "sender" | "text">): string {
  return [message.sentAt, normalizeSender(message.sender), normalizeText(message.text)].join("\n");
}

/**
 * Deterministic fingerprints for an ordered list of messages.
 *
 * Kakao exports only have minute resolution, so two identical messages from the
 * same sender in the same minute would collide. `occurrenceIndex` (the n-th
 * identical message within this list) keeps them apart and is stable across
 * re-uploads because export order is stable.
 *
 * The room name is deliberately excluded: it contains the member count and
 * changes over time.
 */
export function computeFingerprints(
  messages: ReadonlyArray<Pick<NormalizedMessage, "sentAt" | "sender" | "text">>,
): string[] {
  const seen = new Map<string, number>();
  return messages.map((message) => {
    const key = baseKey(message);
    const occurrenceIndex = seen.get(key) ?? 0;
    seen.set(key, occurrenceIndex + 1);
    const digest = createHash("sha256").update(`${key}\n${occurrenceIndex}`, "utf8").digest("hex");
    return `${VERSION}:${digest}`;
  });
}

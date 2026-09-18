// Source-agnostic message model. Kakao export ingestion produces it today;
// Android notification ingestion (a later milestone) must produce the same shape.

export type MessageSource = "KAKAO_EXPORT";

// SYSTEM lines (join/leave/invite) never become messages; they are only counted.
export type MessageKind = "TEXT" | "DELETED" | "PHOTO" | "MEDIA";

export type NormalizedMessage = {
  /** ISO 8601 with +09:00 offset, minute resolution. e.g. 2025-03-31T12:04:00+09:00 */
  sentAt: string;
  sender: string;
  text: string;
  kind: MessageKind;
  rawText?: string;
};

export type StoredMessage = NormalizedMessage & {
  id: string;
  fingerprint: string;
};

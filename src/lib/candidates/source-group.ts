import { createHash } from "node:crypto";

// Which chat a candidate came from, for grouping the review page. Server-side only (node:crypto).
//
// KakaoTalk names an export "[chat title] [member count] 카카오톡 대화.[ext]". The member count changes
// over time, so the GROUP is the chat title without it: a newer export of the same chat lands in the same
// group. This is a title, not a permanent room id — two chats with the same title are one group, and a
// renamed chat becomes a new one. Every rule about titles and keys lives in this file.

/** What the database knows about a candidate's origin: the first upload that stored its message. */
export type SourceTuple = { filename: string | null; importRoomName: string | null; messageRoomName: string | null };

export const UNKNOWN_TITLE = "출처 미상";
export const SOURCE_KEY_PATTERN = /^s_[0-9a-f]{16}$/;

const clean = (value: string | null | undefined) => (value ?? "").normalize("NFC").trim();

/** "dir\\sub/PULSE 집행위원회 공지방 31 카카오톡 대화.EML" → "PULSE 집행위원회 공지방" */
export function chatTitleFromFilename(filename: string): string | null {
  const base = clean(filename.split(/[\\/]/).pop());
  if (base === "") return null;
  const stem = clean(base.replace(/\.(eml|txt)$/i, ""));
  if (stem === "") return null;
  // Only the LAST numeric token before the fixed suffix is the member count; digits inside the title stay.
  const match = stem.match(/^(.*?)(?:\s+\d+)?\s+카카오톡 대화$/);
  const title = match ? clean(match[1]) : "";
  // A name that does not follow the export pattern is used as it is — nothing is guessed away.
  return title !== "" ? title : stem;
}

/** The room name parsed from inside the file has the same shape: "… 공지방 35". */
export function chatTitleFromRoomName(roomName: string): string | null {
  const name = clean(roomName);
  if (name === "") return null;
  const title = clean(name.replace(/\s+\d+$/, ""));
  return title !== "" ? title : name;
}

export function chatTitleOf(source: SourceTuple): { namespace: "title" | "unknown"; title: string } {
  const title =
    (source.filename ? chatTitleFromFilename(source.filename) : null) ??
    (source.importRoomName ? chatTitleFromRoomName(source.importRoomName) : null) ??
    (source.messageRoomName ? chatTitleFromRoomName(source.messageRoomName) : null);
  return title === null ? { namespace: "unknown", title: UNKNOWN_TITLE } : { namespace: "title", title };
}

/**
 * Opaque, stable key for URLs, forms and React keys. The namespace is part of the hashed tuple, so a chat that
 * is really titled "출처 미상" never collides with the unknown bucket, and no separator trick can forge a key.
 */
export function sourceKeyOf(source: SourceTuple): string {
  const { namespace, title } = chatTitleOf(source);
  const canonical = namespace === "unknown" ? ["unknown"] : ["title", title];
  return `s_${createHash("sha256").update(JSON.stringify(canonical)).digest("hex").slice(0, 16)}`;
}

export type StatusCounts = { PENDING: number; APPROVED: number; IGNORED: number };

export type SourceGroup = {
  key: string;
  title: string;
  /** original upload names merged into this group (several when only the member count differed) */
  filenames: string[];
  /** every stored origin that belongs to this group — what the SQL filter matches on */
  tuples: SourceTuple[];
  counts: StatusCounts;
  total: number;
};

/** Merges stored origins into chat groups. Sorted by title so the page order never jumps. */
export function groupSources(rows: { tuple: SourceTuple; counts: StatusCounts }[]): SourceGroup[] {
  const groups = new Map<string, SourceGroup>();
  for (const { tuple, counts } of rows) {
    const key = sourceKeyOf(tuple);
    const group = groups.get(key) ?? { key, title: chatTitleOf(tuple).title, filenames: [], tuples: [], counts: { PENDING: 0, APPROVED: 0, IGNORED: 0 }, total: 0 };
    groups.set(key, group);
    group.tuples.push(tuple);
    const name = clean(tuple.filename?.split(/[\\/]/).pop());
    if (name !== "" && !group.filenames.includes(name)) group.filenames.push(name);
    for (const status of ["PENDING", "APPROVED", "IGNORED"] as const) group.counts[status] += counts[status];
    group.total += counts.PENDING + counts.APPROVED + counts.IGNORED;
  }
  return [...groups.values()].sort((a, b) => a.title.localeCompare(b.title, "ko") || a.key.localeCompare(b.key));
}

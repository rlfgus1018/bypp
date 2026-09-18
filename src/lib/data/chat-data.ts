import { chatTitleOf, sourceKeyOf, type SourceTuple } from "@/lib/candidates/source-group";
import { backupDb } from "@/lib/db/backup";
import type { Db } from "@/lib/db/client";
import { chatDataRepo } from "@/lib/db/repositories/chat-data";

// Everything BYPP stores about one chat — uploads, messages, candidates, calendar events and their Google
// sync records — found by the same chat key the review page and the calendar filter use, and deleted in
// one transaction after a backup. Google itself is never called: events already created there stay there.

export type ChatCounts = { imports: number; messages: number; candidates: number; events: number; googleSynced: number };

export type ChatSummary = { key: string; title: string; filenames: string[]; counts: ChatCounts };

type ChatRows = ChatSummary & { importIds: string[]; messageIds: string[]; candidateIds: string[]; eventIds: string[] };

function collect(db: Db): Map<string, ChatRows> {
  const repo = chatDataRepo(db);
  const chats = new Map<string, ChatRows>();
  const chatFor = (tuple: SourceTuple) => {
    const key = sourceKeyOf(tuple);
    let chat = chats.get(key);
    if (!chat) {
      chat = { key, title: chatTitleOf(tuple).title, filenames: [], counts: { imports: 0, messages: 0, candidates: 0, events: 0, googleSynced: 0 }, importIds: [], messageIds: [], candidateIds: [], eventIds: [] };
      chats.set(key, chat);
    }
    return chat;
  };

  const chatOfImport = new Map<string, ChatRows>();
  for (const upload of repo.imports()) {
    const chat = chatFor({ filename: upload.filename, importRoomName: upload.roomName, messageRoomName: null });
    chat.importIds.push(upload.id);
    const name = upload.filename.split(/[\\/]/).pop() ?? upload.filename;
    if (!chat.filenames.includes(name)) chat.filenames.push(name);
    chatOfImport.set(upload.id, chat);
  }
  const chatOfMessage = new Map<string, ChatRows>();
  for (const message of repo.messageOrigins()) {
    // A message belongs to the upload that first stored it; one without an upload record falls back to its room name.
    const chat = (message.importId ? chatOfImport.get(message.importId) : undefined) ?? chatFor({ filename: null, importRoomName: null, messageRoomName: message.messageRoomName });
    chat.messageIds.push(message.id);
    chatOfMessage.set(message.id, chat);
  }
  const chatOfCandidate = new Map<string, ChatRows>();
  for (const candidate of repo.candidates()) {
    const chat = chatOfMessage.get(candidate.messageId);
    if (!chat) continue;
    chat.candidateIds.push(candidate.id);
    chatOfCandidate.set(candidate.id, chat);
  }
  const chatOfEvent = new Map<string, ChatRows>();
  for (const event of repo.derivedEvents()) {
    const chat = chatOfCandidate.get(event.candidateId);
    if (!chat) continue;
    chat.eventIds.push(event.id);
    chatOfEvent.set(event.id, chat);
  }
  for (const sync of repo.syncs()) {
    const chat = sync.status === "SYNCED" ? chatOfEvent.get(sync.eventId) : undefined;
    if (chat) chat.counts.googleSynced += 1;
  }

  for (const chat of chats.values()) {
    chat.counts.imports = chat.importIds.length;
    chat.counts.messages = chat.messageIds.length;
    chat.counts.candidates = chat.candidateIds.length;
    chat.counts.events = chat.eventIds.length;
  }
  return chats;
}

/** Every chat BYPP holds data for, by title. Read-only. */
export function listChatData(db: Db): ChatSummary[] {
  return [...collect(db).values()]
    .map(({ key, title, filenames, counts }) => ({ key, title, filenames, counts }))
    .sort((a, b) => a.title.localeCompare(b.title, "ko") || a.key.localeCompare(b.key));
}

export type DeleteChatResult =
  | { ok: true; deleted: Omit<ChatCounts, "googleSynced">; backup: string | null }
  | { ok: false; reason: "unknown-chat" | "changed" | "sync-in-progress" };

/**
 * Deletes one chat's data, all or nothing. `expected` is what the user was shown: if the data changed since
 * (an upload or extraction in between), nothing is deleted. A backup is written first (file databases).
 */
export function deleteChatData(db: Db, key: string, expected: Omit<ChatCounts, "googleSynced">, { now = Date.now() } = {}): DeleteChatResult {
  const nowIso = new Date(now).toISOString();
  /** The chat as it is now, or why it must not be deleted. */
  const check = (): ChatRows | Exclude<DeleteChatResult, { ok: true }> => {
    const chat = collect(db).get(key);
    if (!chat) return { ok: false, reason: "unknown-chat" };
    const { imports, messages, candidates, events } = chat.counts;
    if (imports !== expected.imports || messages !== expected.messages || candidates !== expected.candidates || events !== expected.events) {
      return { ok: false, reason: "changed" };
    }
    const eventIds = new Set(chat.eventIds);
    const sending = chatDataRepo(db)
      .syncs()
      .some((sync) => sync.status === "SYNCING" && (sync.leaseExpiresAt ?? "") > nowIso && eventIds.has(sync.eventId));
    return sending ? { ok: false, reason: "sync-in-progress" } : chat;
  };

  const first = check();
  if ("ok" in first) return first;
  const backup = backupDb(db, "before-delete-chat"); // outside the transaction (VACUUM INTO cannot run inside one)
  const outcome = db
    .transaction(() => {
      // Checked again under the write lock: an upload, an extraction or a Google send may have started meanwhile.
      const chat = check();
      return "ok" in chat ? chat : ({ ok: true, deleted: chatDataRepo(db).deleteRows(chat), backup } as const);
    })
    .immediate();
  return outcome;
}

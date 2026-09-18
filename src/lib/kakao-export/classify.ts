import type { MessageKind } from "@/lib/messages/types";

const DELETED = /^(메시지가 삭제되었습니다\.?|삭제된 메시지입니다\.?)$/;
const PHOTO = /^사진( \d+장)?$/;
const MEDIA = /^(동영상|이모티콘|음성메시지|보이스톡|페이스톡|라이브톡)( \d+개)?$|^(파일|지도|연락처|음악|투표|선물) ?: .+/;

/** A bare "deleted" placeholder line (the real export prints these without any timestamp or sender). */
export function isDeletedPlaceholder(line: string): boolean {
  return DELETED.test(line.trim());
}

export function classifyMessageText(text: string): MessageKind {
  const trimmed = text.trim();
  if (DELETED.test(trimmed)) return "DELETED";
  if (PHOTO.test(trimmed)) return "PHOTO";
  if (!trimmed.includes("\n") && MEDIA.test(trimmed)) return "MEDIA";
  return "TEXT";
}

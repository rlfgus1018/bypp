import { chatTitleFromRoomName } from "@/lib/candidates/source-group";

/** Total characters of message text allowed in one LLM request; a message longer than this travels alone. */
export const BATCH_CHAR_BUDGET = 4000;

/**
 * Splits the messages that need the LLM into request-sized units, keeping their order.
 *  - at most `size` messages and BATCH_CHAR_BUDGET characters per unit
 *  - never two chats in one unit: what is sent together comes from the same chat. Chats are compared by
 *    title, without the member count the stored room name carries ("… 공지방 35" and "… 36" are one chat)
 * size 1 yields one unit per message (the classic one-message-per-request path).
 */
export function planLlmUnits<T extends { roomName: string | null; text: string }>(messages: T[], size: number): T[][] {
  const chatOf = (message: T) => (message.roomName === null ? null : chatTitleFromRoomName(message.roomName));
  const units: T[][] = [];
  let current: T[] = [];
  let chars = 0;
  for (const message of messages) {
    const fits =
      current.length > 0 && current.length < size && chatOf(current[0]) === chatOf(message) && chars + message.text.length <= BATCH_CHAR_BUDGET;
    if (!fits && current.length > 0) {
      units.push(current);
      current = [];
      chars = 0;
    }
    current.push(message);
    chars += message.text.length;
  }
  if (current.length > 0) units.push(current);
  return units;
}

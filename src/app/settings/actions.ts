"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { SOURCE_KEY_PATTERN } from "@/lib/candidates/source-group";
import { deleteChatData } from "@/lib/data/chat-data";
import { getDb } from "@/lib/db/client";
import { disconnectGoogle } from "@/lib/google/connection";
import { getGoogleRuntime } from "@/lib/google/runtime";
import { getAccessToken } from "@/lib/google/token-service";
import { importantKeywordsRepo } from "@/lib/db/repositories/important-keywords";
import type { KeywordPreview } from "@/lib/importance/keywords";

export type KeywordFormState = { error: string | null; added: string | null };

const refresh = () => {
  // A keyword changes what is important everywhere at once.
  for (const path of ["/settings", "/candidates", "/calendar", "/calendar/google"]) revalidatePath(path);
};

export async function addImportantKeyword(_previous: KeywordFormState, formData: FormData): Promise<KeywordFormState> {
  const input = String(formData.get("keyword") ?? "").slice(0, 200);
  const result = importantKeywordsRepo(getDb()).add(input);
  if (!result.ok) return { error: result.error, added: null };
  refresh();
  return { error: null, added: result.keyword.keyword };
}

export async function removeImportantKeyword(formData: FormData) {
  const id = z.string().min(1).parse(formData.get("id"));
  importantKeywordsRepo(getDb()).remove(id);
  refresh();
}

/** Read-only: how many titles a word would match ("제목 일치"), before it is added. */
export async function previewImportantKeyword(word: string): Promise<KeywordPreview> {
  return importantKeywordsRepo(getDb()).preview(String(word).slice(0, 200));
}

const DeleteChatInput = z.object({
  key: z.string().regex(SOURCE_KEY_PATTERN),
  imports: z.coerce.number().int().min(0),
  messages: z.coerce.number().int().min(0),
  candidates: z.coerce.number().int().min(0),
  events: z.coerce.number().int().min(0),
});

// Deletes everything stored about one chat (after a backup), only if the counts the user confirmed still hold.
// Nothing is sent to Google; events already created there stay. The result goes back as counts only — the chat
// title never enters a URL.
export async function deleteChat(formData: FormData) {
  const input = DeleteChatInput.safeParse(Object.fromEntries(["key", "imports", "messages", "candidates", "events"].map((name) => [name, formData.get(name)])));
  if (!input.success) redirect("/settings?chatError=invalid");
  const { key, ...expected } = input.data;
  const result = deleteChatData(getDb(), key, expected);
  for (const path of ["/upload", "/settings", "/candidates", "/calendar", "/calendar/google"]) revalidatePath(path);
  if (!result.ok) redirect(`/settings?chatError=${result.reason}`);
  const { messages, candidates, events } = result.deleted;
  redirect(`/settings?chatDeleted=${messages}.${candidates}.${events}`);
}

const GOOGLE_PATHS = ["/settings", "/calendar", "/calendar/google", "/upload"];

// The pages only ever read the LOCAL connection record, so a grant removed in the Google account goes unnoticed
// until a send fails. This asks Google now (one forced token refresh — no calendar request, nothing is sent).
export async function checkGoogleConnection() {
  const google = getGoogleRuntime();
  if (!google) redirect("/settings?google=not_configured");
  let result: string;
  try {
    const token = await getAccessToken(getDb(), google.oauth, { nowMs: Date.now(), tokenKey: google.tokenKey, forceRefresh: true });
    result = token.ok ? "check_ok" : token.reason === "network" ? "check_network" : token.reason === "not-connected" ? "check_none" : "check_revoked";
  } catch {
    // Not logging the error object: errors on this path can carry tokens.
    result = "check_network";
  }
  for (const path of GOOGLE_PATHS) revalidatePath(path);
  redirect(`/settings?google=${result}`);
}

// Revokes the grant at Google (best effort) and forgets the account and tokens here. Events already created on
// Google and the local send history stay.
export async function disconnectGoogleAccount() {
  const google = getGoogleRuntime();
  if (!google) redirect("/settings?google=not_configured");
  let result: string;
  try {
    result = await disconnectGoogle(getDb(), google.oauth, { tokenKey: google.tokenKey });
  } catch {
    result = "disconnect_failed";
  }
  for (const path of GOOGLE_PATHS) revalidatePath(path);
  redirect(`/settings?google=${result}`);
}

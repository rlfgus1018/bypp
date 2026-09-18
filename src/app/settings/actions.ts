"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getDb } from "@/lib/db/client";
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

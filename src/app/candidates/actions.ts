"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { applyCandidateStatus, setCandidateImportanceOverride } from "@/lib/calendar/candidate-event-link";
import { getDb } from "@/lib/db/client";
import { EventSyncInProgressError } from "@/lib/db/repositories/calendar-events";
import { changeFilteredCandidates, formParams } from "./bulk-change";
import { CandidateStatusSchema } from "@/lib/schedule/schemas";

const Input = z.object({ id: z.string().min(1), status: CandidateStatusSchema });

// Approving puts the candidate on BYPP's own calendar; any other status takes it off again — one transaction.
// Approving never sends anything to Google: that only happens from the calendar, per event, on request.
export async function setCandidateStatus(formData: FormData) {
  const { id, status } = Input.parse({ id: formData.get("id"), status: formData.get("status") });
  try {
    applyCandidateStatus(getDb(), id, status);
  } catch (error) {
    if (!(error instanceof EventSyncInProgressError)) throw error;
    // The candidate's calendar event is being sent to Google right now; nothing was changed (one transaction).
    redirect(await backToReferer("blocked", "sync"));
  }
  revalidatePath("/candidates");
  revalidatePath("/calendar");
}

const ImportanceInput = z.object({ id: z.string().min(1), importance: z.enum(["important", "not_important", "auto"]) });

// "중요로 / 중요 아님 / 자동". The derived calendar event (if approved) gets the same override, in one transaction.
export async function setCandidateImportance(formData: FormData) {
  const { id, importance } = ImportanceInput.parse({ id: formData.get("id"), importance: formData.get("importance") });
  setCandidateImportanceOverride(getDb(), id, importance === "auto" ? null : importance);
  revalidatePath("/candidates");
  revalidatePath("/calendar");
}

/** The page the form was on, as a same-origin path with one extra flag. Never an arbitrary URL. */
async function backToReferer(flag: string, value: string): Promise<string> {
  const fallback = `/candidates?${flag}=${value}`;
  const referer = (await headers()).get("referer");
  if (!referer) return fallback;
  try {
    const url = new URL(referer);
    if (url.pathname !== "/candidates") return fallback;
    url.searchParams.set(flag, value);
    return `${url.pathname}?${url.searchParams.toString()}`;
  } catch {
    return fallback;
  }
}

export type BulkState = { error: string | null };

// Applies one status to EVERYTHING the current tab + search + chat matches (not just the cards on screen).
// All rules live in ./bulk-change.ts; this wrapper only adds what needs Next.js.
export async function setFilteredCandidatesStatus(_previous: BulkState, formData: FormData): Promise<BulkState> {
  const result = changeFilteredCandidates(getDb(), formParams(formData));
  if (!result.ok) {
    if (result.listChanged) revalidatePath("/candidates");
    return { error: result.error };
  }
  revalidatePath("/candidates");
  revalidatePath("/calendar");
  redirect(result.redirectTo);
}

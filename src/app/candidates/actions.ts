"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { applyCandidateStatus, applyCandidateStatusToMany, approveMany } from "@/lib/calendar/candidate-event-link";
import { getDb } from "@/lib/db/client";
import { EventSyncInProgressError } from "@/lib/db/repositories/calendar-events";
import { candidatesRepo } from "@/lib/db/repositories/candidates";
import { planBulkApproval } from "./bulk-plan";
import { filterFields, readFilters, readTab, toCandidateFilter } from "./filters";
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

const BulkInput = z.object({
  target: CandidateStatusSchema,
  expected: z.coerce.number().int().min(0),
  // Only meaningful for "approve all": how many of them the user was told are already on the calendar,
  // and what they chose to do with those.
  expectedDuplicates: z.coerce.number().int().min(0).default(0),
  duplicates: z.enum(["add", "ignore", "skip"]).optional(),
});

// Applies one status to EVERYTHING the current filter matches (not just the cards on screen). The filter is
// re-read here from the form, and the match count must equal what the user was shown: if the list changed
// in between (extraction still running, another tab), nothing is changed and the user is asked to look again.
export async function setFilteredCandidatesStatus(_previous: BulkState, formData: FormData): Promise<BulkState> {
  const { target, expected, expectedDuplicates, duplicates } = BulkInput.parse({
    target: formData.get("target"),
    expected: formData.get("expected"),
    expectedDuplicates: formData.get("expectedDuplicates") ?? undefined,
    duplicates: formData.get("duplicates") ?? undefined,
  });
  const params = Object.fromEntries([...formData.entries()].filter(([, value]) => typeof value === "string")) as Record<string, string>;
  const tab = readTab(params);
  if (tab === target) return { error: "이미 그 상태인 목록입니다." };

  const db = getDb();
  const values = readFilters(params);
  const ids = candidatesRepo(db).listIds(toCandidateFilter(values, tab));
  if (ids.length !== expected) {
    revalidatePath("/candidates");
    return { error: `목록이 그 사이에 바뀌었습니다(화면 ${expected}건 → 현재 ${ids.length}건). 아무것도 바꾸지 않았습니다. 목록을 다시 확인해 주세요.` };
  }

  // For "approve all", what the user was told about duplicates must still hold, and they must have chosen.
  const split = target === "APPROVED" ? planBulkApproval(db, values, tab) : null;
  if (split && split.duplicates.length !== expectedDuplicates) {
    revalidatePath("/candidates");
    return { error: `캘린더와 겹치는 후보 수가 그 사이에 바뀌었습니다(화면 ${expectedDuplicates}건 → 현재 ${split.duplicates.length}건). 아무것도 바꾸지 않았습니다. 다시 확인해 주세요.` };
  }
  if (split && split.duplicates.length > 0 && !duplicates) return { error: "이미 캘린더에 있는 일정과 겹치는 후보를 어떻게 할지 선택해 주세요." };

  let changed: number;
  try {
    changed = split ? approveMany(db, split, duplicates ?? "add").approved : applyCandidateStatusToMany(db, ids, target);
  } catch (error) {
    if (!(error instanceof EventSyncInProgressError)) throw error;
    // One transaction: the in-flight event blocked its delete, so nothing at all was changed.
    return { error: "이 중 한 일정이 지금 Google로 전송되는 중입니다. 아무것도 바꾸지 않았습니다. 잠시 후 다시 시도해 주세요." };
  }
  revalidatePath("/candidates");
  revalidatePath("/calendar");
  // Back to the same tab and filter (usually empty now), with a note of what just happened.
  const query = new URLSearchParams({ status: tab, ...filterFields(values), done: `${changed}:${target}` });
  if (split && split.duplicates.length > 0) query.set("dup", `${split.duplicates.length}:${duplicates}`);
  redirect(`/candidates?${query.toString()}`);
}

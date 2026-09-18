import { z } from "zod";
import { applyCandidateStatusToMany, approveMany } from "@/lib/calendar/candidate-event-link";
import type { Db } from "@/lib/db/client";
import { EventSyncInProgressError } from "@/lib/db/repositories/calendar-events";
import { candidatesRepo } from "@/lib/db/repositories/candidates";
import { CandidateStatusSchema } from "@/lib/schedule/schemas";
import { loadSourceGroups, planBulkApproval } from "./bulk-plan";
import { filterFields, readFilters, readTab, resolveScope, toCandidateFilter } from "./filters";

// The bulk status change, free of Next.js (the server action in ./actions.ts is a thin wrapper), so its
// scope rules can be tested directly: it changes exactly what the list showed — this tab, these search
// conditions, this chat — or nothing at all.

const BulkInput = z.object({
  target: CandidateStatusSchema,
  expected: z.coerce.number().int().min(0),
  // Only meaningful for "approve all": how many of them the user was told are already on the calendar,
  // and what they chose to do with those.
  expectedDuplicates: z.coerce.number().int().min(0).default(0),
  duplicates: z.enum(["add", "ignore", "skip"]).optional(),
});

export type BulkChangeResult = { ok: false; error: string; listChanged: boolean } | { ok: true; redirectTo: string };

/** Form fields as a params object. A repeated field stays an array, so two "source" values are seen for what they are. */
export function formParams(formData: FormData): Record<string, string | string[]> {
  const params: Record<string, string | string[]> = {};
  for (const key of new Set(formData.keys())) {
    const all = formData.getAll(key).filter((value): value is string => typeof value === "string");
    if (all.length > 0) params[key] = all.length === 1 ? all[0] : all;
  }
  return params;
}

export function changeFilteredCandidates(db: Db, params: Record<string, string | string[]>): BulkChangeResult {
  const one = (key: string) => (typeof params[key] === "string" ? (params[key] as string) : undefined);
  const { target, expected, expectedDuplicates, duplicates } = BulkInput.parse({
    target: one("target"),
    expected: one("expected"),
    expectedDuplicates: one("expectedDuplicates"),
    duplicates: one("duplicates"),
  });
  const refuse = (error: string, listChanged = false): BulkChangeResult => ({ ok: false, error, listChanged });

  const tab = readTab(params);
  if (tab === target) return refuse("이미 그 상태인 목록입니다.");

  const values = readFilters(params);
  // The chat is re-resolved here, against the chats that exist now. An unknown or malformed one is refused —
  // for a write it must never fall back to "all chats".
  const scope = resolveScope(values, loadSourceGroups(db));
  if (scope.kind === "unknown") return refuse("알 수 없는 채팅방입니다. 아무것도 바꾸지 않았습니다. 목록을 다시 열어 주세요.");
  if (values.importanceInvalid) return refuse("알 수 없는 중요 범위입니다. 아무것도 바꾸지 않았습니다. 목록을 다시 열어 주세요.");

  // The match count must equal what the user was shown: if the list changed in between (extraction still
  // running, another tab), nothing is changed and the user is asked to look again.
  const ids = candidatesRepo(db).listIds(toCandidateFilter(values, tab, scope));
  if (ids.length !== expected) return refuse(`목록이 그 사이에 바뀌었습니다(화면 ${expected}건 → 현재 ${ids.length}건). 아무것도 바꾸지 않았습니다. 목록을 다시 확인해 주세요.`, true);

  // For "approve all", what the user was told about duplicates must still hold, and they must have chosen.
  const split = target === "APPROVED" ? planBulkApproval(db, values, tab, scope) : null;
  if (split && split.duplicates.length !== expectedDuplicates) {
    return refuse(`캘린더와 겹치는 후보 수가 그 사이에 바뀌었습니다(화면 ${expectedDuplicates}건 → 현재 ${split.duplicates.length}건). 아무것도 바꾸지 않았습니다. 다시 확인해 주세요.`, true);
  }
  if (split && split.duplicates.length > 0 && !duplicates) return refuse("이미 캘린더에 있는 일정과 겹치는 후보를 어떻게 할지 선택해 주세요.");

  let changed: number;
  try {
    changed = split ? approveMany(db, split, duplicates ?? "add").approved : applyCandidateStatusToMany(db, ids, target);
  } catch (error) {
    if (!(error instanceof EventSyncInProgressError)) throw error;
    // One transaction: the in-flight event blocked its delete, so nothing at all was changed.
    return refuse("이 중 한 일정이 지금 Google로 전송되는 중입니다. 아무것도 바꾸지 않았습니다. 잠시 후 다시 시도해 주세요.");
  }

  // Back to the same tab, search and chat (usually empty now), with a note of what just happened.
  const query = new URLSearchParams({ status: tab, ...filterFields(values), done: `${changed}:${target}` });
  if (split && split.duplicates.length > 0) query.set("dup", `${split.duplicates.length}:${duplicates}`);
  return { ok: true, redirectTo: `/candidates?${query.toString()}` };
}

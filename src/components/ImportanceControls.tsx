import type { ImportanceReason } from "@/lib/importance/match";

// Shared by the review cards and the calendar detail panel: the ★ badge with its reason, and the three
// buttons ("중요로 / 중요 아님 / 자동"). The form action is passed in, so each screen calls its own
// server action (which keeps candidate and derived event in step).

export function reasonText(reason: ImportanceReason): string | null {
  switch (reason.type) {
    case "override-important":
      return "직접 지정";
    case "keyword":
      return `단어: ${reason.keyword}`;
    case "override-not-important":
      return "중요 아님으로 지정됨";
    default:
      return null;
  }
}

export const isImportantReason = (reason: ImportanceReason) => reason.type === "override-important" || reason.type === "keyword";

export function ImportanceBadge({ reason }: { reason: ImportanceReason }) {
  if (!isImportantReason(reason)) return null;
  return (
    <span className="rounded bg-amber-100 px-2 py-0.5 font-medium text-amber-900" title="중요 일정">
      ★ 중요 <span className="font-normal">· {reasonText(reason)}</span>
    </span>
  );
}

export function ImportanceButtons({
  id,
  reason,
  action,
  extraFields = {},
}: {
  id: string;
  reason: ImportanceReason;
  action: (formData: FormData) => void | Promise<void>;
  /** hidden fields the action needs besides id / importance (e.g. the calendar month to return to) */
  extraFields?: Record<string, string>;
}) {
  const button = (value: "important" | "not_important" | "auto", label: string) => (
    <form action={action}>
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="importance" value={value} />
      {Object.entries(extraFields).map(([name, fieldValue]) => (
        <input key={name} type="hidden" name={name} value={fieldValue} />
      ))}
      <button type="submit" className="rounded border border-slate-300 px-2 py-1 text-xs text-slate-600 hover:bg-slate-50">
        {label}
      </button>
    </form>
  );
  const overridden = reason.type === "override-important" || reason.type === "override-not-important";
  return (
    <div className="flex flex-wrap items-center gap-1">
      {reason.type !== "override-important" && button("important", "☆ 중요로")}
      {reason.type !== "override-not-important" && isImportantReason(reason) && button("not_important", "중요 아님")}
      {overridden && button("auto", reason.type === "override-not-important" ? "제외 해제 (자동)" : "자동으로 되돌리기")}
    </div>
  );
}

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
    <span className="rounded-[3px] bg-amber-100 px-2 py-0.5 text-[11.5px] font-semibold text-amber-900" title="중요 일정">
      ★ 중요 <span className="font-normal">· {reasonText(reason)}</span>
    </span>
  );
}

export function ImportanceButtons({
  id,
  reason,
  action,
  extraFields = {},
  layout = "inline",
}: {
  id: string;
  reason: ImportanceReason;
  action: (formData: FormData) => void | Promise<void>;
  /** hidden fields the action needs besides id / importance (e.g. the calendar view to return to); arrays repeat */
  extraFields?: Record<string, string | string[]>;
  /** "stack": full-width buttons for a card's action column */
  layout?: "inline" | "stack";
}) {
  const important = isImportantReason(reason);
  const button = (value: "important" | "not_important" | "auto", label: string, tone: "amber" | "plain" | "link") => (
    <form action={action} className={layout === "stack" ? "w-full" : undefined}>
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="importance" value={value} />
      <HiddenFields fields={extraFields} />
      <button
        type="submit"
        className={`${layout === "stack" ? "w-full" : ""} rounded ${
          tone === "link"
            ? "px-1 py-0.5 text-[11.5px] text-ink-500 underline-offset-2 hover:underline"
            : tone === "amber"
              ? "border border-amber-500 px-2.5 py-1.5 text-xs text-amber-800 hover:bg-amber-50"
              : "border border-slate-300 bg-white px-2.5 py-1.5 text-xs text-slate-700 hover:bg-slate-50"
        }`}
      >
        {label}
      </button>
    </form>
  );
  const overridden = reason.type === "override-important" || reason.type === "override-not-important";
  return (
    <div className={layout === "stack" ? "flex flex-col items-stretch gap-1" : "flex flex-wrap items-center gap-1"}>
      {important ? button("not_important", "중요 해제", "amber") : button("important", "☆ 중요 지정", "plain")}
      {overridden && button("auto", reason.type === "override-not-important" ? "제외 해제 (자동)" : "자동으로 되돌리기", "link")}
    </div>
  );
}

/** Hidden inputs for a form; an array value becomes one input per element (e.g. repeated src). */
export function HiddenFields({ fields }: { fields: Record<string, string | string[]> }) {
  return Object.entries(fields).flatMap(([name, value]) =>
    (Array.isArray(value) ? value : [value]).map((item, index) => <input key={`${name}-${index}`} type="hidden" name={name} value={item} />),
  );
}

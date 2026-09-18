import Link from "next/link";
import { GoogleBulkSend, type BulkSendItem } from "@/components/GoogleBulkSend";
import { formatEventWhen, formatInstant } from "@/lib/calendar/format";
import { nowMs, parseDay } from "@/lib/calendar/month-grid";
import type { CalendarEvent } from "@/lib/calendar/types";
import { getDb } from "@/lib/db/client";
import { planBulkSend, type BulkScope } from "@/lib/google/bulk-plan";
import { getConnectionView } from "@/lib/google/connection";
import { DEFAULT_END_TEXT, DEFAULT_GOOGLE_EVENT_DURATION_MINUTES, NOT_SYNCABLE_TEXT } from "@/lib/google/event-mapper";
import { isGoogleConfigured } from "@/lib/google/runtime";

export const dynamic = "force-dynamic";

const eventHref = (event: CalendarEvent) => `/calendar?${event.startAt ? `month=${event.startAt.slice(0, 7)}&` : ""}event=${event.id}`;

// Review-before-send. Rendering this page reads the local database only: it never calls Google and never
// writes. Events are created on Google solely by the action the client component calls for the ticked events.
export default async function GoogleBulkSendPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const params = await searchParams;
  const one = (key: string) => (typeof params[key] === "string" ? (params[key] as string) : "");
  const from = parseDay(one("from")) ? one("from") : "";
  const to = parseDay(one("to")) ? one("to") : "";
  const badRange = from !== "" && to !== "" && from > to;
  // Default = important only. An unknown scope is refused (nothing to send), never widened to "all".
  const rawScope = params.scope;
  const scope: BulkScope | null = rawScope === undefined || rawScope === "important" ? "important" : rawScope === "all" ? "all" : null;

  const db = getDb();
  const connection = getConnectionView(db, isGoogleConfigured());
  const range = badRange ? { from: null, to: null } : { from: from || null, to: to || null };
  const now = nowMs();
  const importantPlan = planBulkSend(db, now, range, "important");
  const allPlan = planBulkSend(db, now, range, "all");
  const plan = scope === "all" ? allPlan : scope === "important" ? importantPlan : { sendable: [], created: [], blocked: [], sending: [] };
  const scopeHref = (value: BulkScope) => {
    const query = new URLSearchParams({ scope: value });
    if (from) query.set("from", from);
    if (to) query.set("to", to);
    return `/calendar/google?${query.toString()}`;
  };
  const scopeTab = (value: BulkScope, label: string, count: number) => (
    <Link
      href={scopeHref(value)}
      aria-current={scope === value ? "page" : undefined}
      className={`rounded-full px-3 py-1 ${
        scope === value ? (value === "important" ? "bg-amber-500 text-white" : "bg-slate-900 text-white") : "border border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
      }`}
    >
      {label} <span className="tabular-nums opacity-80">{count.toLocaleString()}</span>
    </Link>
  );

  const items: BulkSendItem[] = plan.sendable.map(({ event, retry, sameSlot, defaultEnd }) => ({
    id: event.id,
    title: event.title,
    when: formatEventWhen(event),
    month: event.startAt?.slice(0, 7) ?? "",
    location: event.location,
    retry,
    sameSlot,
    defaultEnd,
  }));
  const field = "rounded border border-slate-300 bg-white px-2 py-1";

  return (
    // Same wider column as the calendar itself.
    <div className="space-y-4 lg:-mx-28">
      <div>
        <Link href="/calendar" className="text-sm text-slate-600 underline">
          ← 캘린더로
        </Link>
        <h1 className="mt-1 text-xl font-semibold">Google 캘린더로 한꺼번에 보내기</h1>
        <p className="mt-1 text-sm text-slate-500">
          BYPP 캘린더의 일정 중 아직 보내지 않은 것을 골라 Google 기본 캘린더에 생성합니다. 보내고 싶지 않은 일정은 체크를 해제하세요. 생성만 하며(단방향), 이미 보낸 일정의
          수정·삭제는 Google에 반영되지 않습니다.
        </p>
      </div>

      <nav className="flex flex-wrap items-center gap-2 text-sm" aria-label="보낼 범위">
        {scopeTab("important", "★ 중요만", importantPlan.sendable.length)}
        {scopeTab("all", "전체", allPlan.sendable.length)}
        <span className="text-xs text-slate-500">
          숫자는 지금 보낼 수 있는 일정 수입니다(이미 보낸 일정·보낼 수 없는 일정 제외).{" "}
          <Link href="/settings" className="underline">
            중요 단어 설정
          </Link>
        </span>
      </nav>
      {scope === null && (
        <p className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-800" role="alert">
          알 수 없는 보내기 범위입니다. 아무것도 보내지 않습니다.{" "}
          <Link href={scopeHref("important")} className="underline">
            중요만 보기
          </Link>
        </p>
      )}
      {scope === "important" && (
        <p className="text-xs text-slate-500">
          중요 일정만 보냅니다. 보내기 직전에 서버에서 중요 여부를 다시 확인하고, 그 사이 중요에서 빠진 일정은 보내지 않습니다. 중요에서 빠져도 이미 Google에 만든
          일정은 지우지 않습니다.
        </p>
      )}

      <p className="rounded-lg border border-slate-200 bg-white p-3 text-sm tabular-nums">
        {scope === "important" ? "중요 일정 중 " : ""}보낼 수 있음 <strong>{plan.sendable.length.toLocaleString()}</strong> · 이미 생성됨 {plan.created.length.toLocaleString()} · 보낼 수 없음 {plan.blocked.length.toLocaleString()}
        {plan.sending.length > 0 ? ` · 전송 중 ${plan.sending.length.toLocaleString()}` : ""}
      </p>

      <form method="get" action="/calendar/google" className="flex flex-wrap items-end gap-2 rounded-lg border border-slate-200 bg-white p-3 text-sm">
        {scope && <input type="hidden" name="scope" value={scope} />}
        <label className="flex flex-col gap-1">
          <span className="text-xs text-slate-500">일정 날짜 시작</span>
          <input type="date" name="from" defaultValue={from} className={field} />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-slate-500">끝</span>
          <input type="date" name="to" defaultValue={to} className={field} />
        </label>
        <button type="submit" className="rounded bg-slate-900 px-3 py-1.5 text-white">
          기간 적용
        </button>
        {(from || to) && (
          <Link href={`/calendar/google?scope=${scope ?? "important"}`} className="rounded border border-slate-300 px-3 py-1.5">
            전체 기간
          </Link>
        )}
        <span className="text-xs text-slate-500">비워 두면 전체 일정입니다. 기간을 정하면 날짜 미확정 일정은 제외됩니다.</span>
        {badRange && <span className="text-xs text-red-700">시작 날짜가 끝 날짜보다 늦어 기간을 적용하지 않았습니다.</span>}
      </form>

      {connection.state !== "connected" ? (
        <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          {connection.state === "not-configured"
            ? "Google 연동 환경변수가 설정되지 않아 보낼 수 없습니다."
            : connection.state === "needs-reconnect"
              ? "Google 계정을 다시 연결해야 보낼 수 있습니다."
              : "Google 계정이 연결되어 있지 않습니다."}{" "}
          <Link href="/calendar" className="underline">
            캘린더 화면에서 연결
          </Link>
        </p>
      ) : scope === null ? null : items.length === 0 ? (
        <p className="rounded-lg border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500">
          {from || to ? "이 기간에는 " : ""}새로 보낼 수 있는 {scope === "important" ? "중요 " : ""}일정이 없습니다.
          {scope === "important" && allPlan.sendable.length > 0 && (
            <>
              {" "}
              <Link href={scopeHref("all")} className="underline">
                전체 일정 보기 ({allPlan.sendable.length.toLocaleString()}건)
              </Link>
            </>
          )}
        </p>
      ) : (
        // Remounts when the set of sendable events changes (after a refresh), so ticks and results start clean.
        <GoogleBulkSend key={`${scope}:${items.map((item) => item.id).join(",")}`} items={items} accountEmail={connection.email}
          scope={scope}
          defaultEndText={DEFAULT_END_TEXT}
          defaultEndMinutes={DEFAULT_GOOGLE_EVENT_DURATION_MINUTES}
        />
      )}

      {plan.blocked.length > 0 && (
        <section className="rounded-lg border border-slate-200 bg-white p-4 text-sm">
          <h2 className="font-semibold">보낼 수 없는 일정 {plan.blocked.length.toLocaleString()}건</h2>
          <p className="mt-1 text-xs text-slate-500">일정을 열어 고치면 보낼 수 있게 됩니다. (끝 시각만 없는 일정은 여기가 아니라 위 목록에서 보낼 수 있습니다.)</p>
          <ul className="mt-2 divide-y divide-slate-100">
            {plan.blocked.map(({ event, reason }) => (
              <li key={event.id} className="flex flex-wrap items-baseline gap-x-2 py-1.5">
                <Link href={eventHref(event)} className="min-w-0 break-words font-medium underline">
                  {event.title}
                </Link>
                <span className="text-xs text-slate-500">{formatEventWhen(event)}</span>
                <span className="w-full text-xs text-slate-600">{NOT_SYNCABLE_TEXT[reason]}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {plan.created.length > 0 && (
        <details className="rounded-lg border border-slate-200 bg-white p-4 text-sm">
          <summary className="cursor-pointer font-semibold">이미 Google에 생성된 일정 {plan.created.length.toLocaleString()}건</summary>
          <ul className="mt-2 divide-y divide-slate-100">
            {plan.created.map(({ event, editedSince, syncedAt }) => (
              <li key={event.id} className="flex flex-wrap items-baseline gap-x-2 py-1.5">
                <Link href={eventHref(event)} className="min-w-0 break-words font-medium underline">
                  {event.title}
                </Link>
                <span className="text-xs text-slate-500">
                  {formatEventWhen(event)}
                  {syncedAt ? ` · ${formatInstant(syncedAt)} 생성` : ""}
                </span>
                {editedSince && <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-800">이후 로컬 수정은 Google에 반영 안 됨</span>}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

import Link from "next/link";
import { AssistantCard } from "@/components/AssistantCard";
import { UploadForm } from "@/components/UploadForm";
import { formatClock, formatInstant } from "@/lib/calendar/format";
import { kstToday, nowMs } from "@/lib/calendar/month-grid";
import { isPartnership } from "@/lib/calendar/partnership";
import { chatTitleOf } from "@/lib/candidates/source-group";
import { getReadDb } from "@/lib/db/client";
import { calendarEventsRepo } from "@/lib/db/repositories/calendar-events";
import { candidatesRepo } from "@/lib/db/repositories/candidates";
import { importsRepo } from "@/lib/db/repositories/imports";
import { messagesRepo } from "@/lib/db/repositories/messages";
import { planBulkSend } from "@/lib/google/bulk-plan";
import { getConnectionView } from "@/lib/google/connection";
import { isGoogleConfigured } from "@/lib/google/runtime";
import { parseIsoToKst, toIsoKst, weekdayOf, WEEKDAY_NAMES } from "@/lib/schedule/kst";
import { describeLlm, llmConfigWarnings, resolveLlmConfig } from "@/lib/schedule/factory";

export const dynamic = "force-dynamic";

const UPCOMING = 3;

// Rendering only reads: the local database and the environment. Nothing is sent anywhere.
export default async function HomePage() {
  const db = await getReadDb();
  const statuses = messagesRepo(db).countByStatus();
  const recent = importsRepo(db).listRecent(5);
  const pending = candidatesRepo(db).countByStatus({}).PENDING;
  // Computed on the server; only this plain string (never the key) reaches the browser.
  const llm = resolveLlmConfig();
  const llmLabel = describeLlm(llm);
  const configWarnings = llmConfigWarnings();
  const providerLabel = llm?.provider === "openrouter" ? "OpenRouter/DeepSeek" : "Google Gemini";

  const today = toIsoKst(kstToday());
  const upcoming = calendarEventsRepo(db)
    .listOverlapping(today, "9999-12-31T00:00:00+09:00")
    // starting today or later (ongoing multi-day periods are not "coming up")
    .filter((event) => event.startAt !== null && event.startAt >= today && !isPartnership(event) && event.kind === "EVENT")
    .slice(0, UPCOMING);
  const connection = getConnectionView(db, isGoogleConfigured());
  const importantSendable = connection.state === "connected" ? planBulkSend(db, nowMs(), undefined, "important").sendable.length : 0;

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_300px]">
      <div className="min-w-0 space-y-3.5">
        <h1 className="text-[21px] font-semibold">KakaoTalk 대화 가져오기</h1>

        <div className={`rounded-lg border px-4 py-3 text-sm ${llm ? "border-amber-300 bg-amber-50" : "border-slate-200 bg-white"}`}>
          <div className="flex flex-wrap items-center gap-2.5">
            <span
              className={`rounded-[3px] px-2 py-0.5 font-display text-[11.5px] font-medium ${llm ? "bg-amber-200 text-amber-900" : "bg-slate-100 text-slate-700"}`}
            >
              {llm ? "LLM ON" : "LLM OFF"}
            </span>
            <span className={`text-[12.5px] ${llm ? "text-amber-900" : "text-ink-600"}`}>
              {llm
                ? `${providerLabel} API가 활성화되어 있습니다.`
                : "모든 처리가 이 컴퓨터 안에서 이루어집니다. 애매한 메시지는 저신뢰 추정으로 추출합니다."}
            </span>
            <Link href="/settings#extraction" className="ml-auto text-xs text-ark-700 hover:underline">
              설정에서 확인
            </Link>
          </div>
          {llm && (
            <p className="mt-2 text-[12.5px] leading-relaxed text-amber-900">
              ⚠ 일정 해석이 필요한 일부 카카오톡 메시지(전화번호·이메일·URL 마스킹, 보낸 사람 제외
              {llm.batchSize > 1 ? `, 같은 방의 메시지를 한 요청에 최대 ${llm.batchSize}건씩` : ""})가 외부 {providerLabel} API로 전송될 수 있습니다.
              실제 개인/타인의 대화 데이터를 전송하기 전에 선택한 공급자의 최신 데이터 처리 정책을 확인하세요.{" "}
              <span className="font-display text-xs">({llmLabel})</span>
            </p>
          )}
          {configWarnings.map((warning) => (
            <p key={warning} className="mt-1 text-xs text-red-700" role="alert">
              {warning} (.env.local 확인 후 개발 서버를 다시 시작하세요)
            </p>
          ))}
        </div>

        <UploadForm
          initialOverall={{ extracted: statuses.EXTRACTED ?? 0, failed: statuses.FAILED ?? 0, pending: statuses.PENDING_EXTRACTION ?? 0 }}
          llmEnabled={llm !== null}
          llmPlan={{ batchSize: llm?.batchSize ?? 1, rpm: llm?.rpm ?? 0, concurrency: llm?.concurrency ?? 1 }}
        />

        {recent.length > 0 && (
          <section className="overflow-hidden rounded-lg border border-slate-200 bg-white" aria-label="최근 가져오기">
            <h2 className="flex items-center gap-2 border-b border-slate-200 px-4 py-2.5 text-[13.5px] font-semibold">
              최근 가져오기 <span className="font-display text-xs font-normal text-ink-500">{recent.length}</span>
            </h2>
            <ul className="divide-y divide-slate-100 text-[13px]">
              {recent.map((item) => (
                <li key={item.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5">
                  <span className="min-w-0 flex-1 break-words" title={item.filename}>
                    {chatTitleOf({ filename: item.filename, importRoomName: item.roomName, messageRoomName: null }).title}
                  </span>
                  <span className="text-xs text-ink-600">
                    신규 <span className="font-display">{item.newMessages.toLocaleString()}</span> · 추출 대상{" "}
                    <span className="font-display">{item.detectedCount.toLocaleString()}</span>
                    {item.outOfRangeCount > 0 ? ` · 기간 밖 보류 ${item.outOfRangeCount.toLocaleString()}` : ""}
                    {item.rangeFrom || item.rangeTo ? ` · 기간 ${item.rangeFrom ?? "처음"}~${item.rangeTo ?? "끝"}` : ""}
                  </span>
                  <span className="font-display text-xs text-ink-500">{formatInstant(item.createdAt)}</span>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>

      <aside className="space-y-3.5" aria-label="요약">
        <AssistantCard
          message={
            pending > 0 ? (
              <>
                검토 대기 <span className="font-display">{pending.toLocaleString()}</span>건이
                <br />
                기다리고 있어요
              </>
            ) : (
              <>
                검토할 후보가
                <br />
                없어요
              </>
            )
          }
          href={pending > 0 ? "/candidates" : undefined}
          linkLabel="검토하러 가기 →"
        />

        <section className="rounded-lg border border-slate-200 bg-white p-4" aria-label="다가오는 일정">
          <div className="flex items-baseline justify-between">
            <h2 className="text-[13.5px] font-semibold">다가오는 일정</h2>
            <Link href="/calendar" className="text-xs text-ark-700 hover:underline">
              캘린더 →
            </Link>
          </div>
          {upcoming.length === 0 ? (
            <p className="mt-2 text-xs text-ink-500">예정된 일정이 없습니다. 후보를 승인하면 여기에 나타납니다.</p>
          ) : (
            <ul className="mt-2.5 divide-y divide-slate-100">
              {upcoming.map((event, index) => {
                const { date } = parseIsoToKst(event.startAt!);
                return (
                  <li key={event.id}>
                    <Link
                      href={`/calendar?month=${event.startAt!.slice(0, 7)}&event=${event.id}`}
                      className="flex items-center gap-2.5 py-2 hover:bg-slate-50"
                    >
                      <span className={`w-10 shrink-0 rounded-[3px] py-1 text-center ${index === 0 ? "bg-slate-900 text-white" : "bg-slate-100"}`}>
                        <span className="block font-display text-[15px] font-bold leading-tight">{date.d}</span>
                        <span className={`block text-[9.5px] ${index === 0 ? "text-mist-300" : "text-ink-500"}`}>
                          {date.m}월 {WEEKDAY_NAMES[weekdayOf(date)][0]}
                        </span>
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate text-[13px] font-medium">{event.title}</span>
                        <span className="block truncate text-[11.5px] text-ink-500">
                          {event.allDay ? "종일" : formatClock(event.startAt!)}
                          {event.location ? ` · ${event.location}` : event.category === "DEADLINE" ? " · 마감" : ""}
                        </span>
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section className="rounded-lg border border-slate-200 bg-white px-4 py-3.5" aria-label="Google 캘린더">
          <div className="flex items-center gap-2">
            <h2 className="text-[13.5px] font-semibold">Google 캘린더</h2>
            <span
              className={`ml-auto text-xs ${connection.state === "connected" ? "text-emerald-700" : connection.state === "needs-reconnect" ? "text-amber-700" : "text-ink-500"}`}
            >
              {connection.state === "connected"
                ? "연결됨"
                : connection.state === "needs-reconnect"
                  ? "재연결 필요"
                  : connection.state === "not-connected"
                    ? "연결 안 됨"
                    : "설정 미완료"}
            </span>
          </div>
          {connection.state === "connected" ? (
            <Link
              href="/calendar/google?scope=important"
              className="mt-2 block rounded border border-emerald-600 px-2 py-2 text-center text-[13px] font-medium text-emerald-700 hover:bg-emerald-50"
            >
              ★ 중요 일정 Google로 보내기 ({importantSendable.toLocaleString()}건)
            </Link>
          ) : (
            <Link
              href="/calendar"
              className="mt-2 block rounded border border-slate-300 px-2 py-2 text-center text-[13px] text-slate-700 hover:bg-slate-50"
            >
              캘린더에서 연결하기
            </Link>
          )}
        </section>
      </aside>
    </div>
  );
}

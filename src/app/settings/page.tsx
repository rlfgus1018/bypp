import Link from "next/link";
import { AssistantCard } from "@/components/AssistantCard";
import { KeywordForm } from "@/components/KeywordForm";
import { listChatData } from "@/lib/data/chat-data";
import { getDb } from "@/lib/db/client";
import { importantKeywordsRepo } from "@/lib/db/repositories/important-keywords";
import { getConnectionView } from "@/lib/google/connection";
import { isGoogleConfigured } from "@/lib/google/runtime";
import { KEYWORD_MAX_LENGTH, KEYWORD_MIN_LENGTH, MAX_KEYWORDS } from "@/lib/importance/keywords";
import { describeLlm, resolveLlmConfig } from "@/lib/schedule/factory";
import { checkGoogleConnection, deleteChat, disconnectGoogleAccount, removeImportantKeyword } from "./actions";

export const dynamic = "force-dynamic";

const CHAT_ERROR: Record<string, string> = {
  changed: "그 사이 이 채팅방의 데이터가 바뀌어(업로드·추출 등) 아무것도 삭제하지 않았습니다. 건수를 다시 확인해 주세요.",
  "sync-in-progress": "이 채팅방의 일정 하나가 지금 Google로 전송되는 중이라 아무것도 삭제하지 않았습니다. 잠시 후 다시 시도해 주세요.",
  "unknown-chat": "그 채팅방의 데이터를 찾을 수 없습니다. 이미 삭제되었을 수 있습니다.",
  invalid: "요청이 올바르지 않아 아무것도 삭제하지 않았습니다.",
};

// Result codes ./actions.ts may put in ?google=. Anything else is ignored.
const GOOGLE_FLASH: Record<string, { ok: boolean; text: string }> = {
  check_ok: { ok: true, text: "Google에 확인했습니다: 연결이 유효합니다." },
  check_revoked: { ok: false, text: "Google에서 이 앱의 권한이 해제되었거나 만료되었습니다. 상태를 “재연결 필요”로 바꿨습니다." },
  check_network: { ok: false, text: "Google에 연결하지 못해 확인하지 못했습니다. 연결 상태는 바꾸지 않았습니다." },
  check_none: { ok: false, text: "연결된 Google 계정이 없습니다." },
  disconnected: { ok: true, text: "연결을 해제했습니다. Google의 앱 권한을 취소하고, 이 컴퓨터에 저장된 토큰을 지웠습니다. 이미 만든 Google 일정은 그대로입니다." },
  "disconnected-local-only": {
    ok: false,
    text: "이 컴퓨터에 저장된 토큰은 지웠지만, Google 쪽 권한 취소는 확인하지 못했습니다. Google 계정 → 보안 → 서드 파티 앱 액세스에서 직접 삭제해 주세요.",
  },
  "not-connected": { ok: false, text: "연결된 Google 계정이 없습니다." },
  disconnect_failed: { ok: false, text: "연결 해제 중 오류가 발생했습니다. 다시 시도해 주세요." },
  not_configured: { ok: false, text: "Google 연동 환경변수가 설정되지 않았습니다." },
};

const TABLE = "grid grid-cols-[minmax(0,1fr)_repeat(3,64px)_84px] items-center gap-2.5 sm:grid-cols-[minmax(0,1fr)_repeat(3,80px)_110px]";

// Rendering only reads. Keywords are added / removed and chat data is deleted by ./actions.ts.
export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ [key: string]: string | string[] | undefined }> }) {
  const params = await searchParams;
  const db = getDb();
  const repo = importantKeywordsRepo(db);
  const chats = listChatData(db);
  const deleted = typeof params.chatDeleted === "string" ? params.chatDeleted.match(/^(\d+)\.(\d+)\.(\d+)$/) : null;
  const chatError = typeof params.chatError === "string" ? CHAT_ERROR[params.chatError] : undefined;
  const keywords = repo.list();
  const overrides = repo.overrideCounts();
  const reach = new Map(keywords.map((keyword) => [keyword.id, repo.preview(keyword.keyword)]));
  const connection = getConnectionView(db, isGoogleConfigured());
  const googleFlash = typeof params.google === "string" ? GOOGLE_FLASH[params.google] : undefined;
  // Only the provider / model / limits reach the page — never the key.
  const llm = resolveLlmConfig();

  const disconnect = (
    <details className="group">
      <summary className="cursor-pointer list-none rounded border border-red-300 px-3 py-2 text-center text-[13px] text-red-700 hover:bg-red-50 group-open:bg-red-50 [&::-webkit-details-marker]:hidden">
        연결 해제…
      </summary>
      <div className="mt-2 flex flex-col gap-2 rounded border border-red-200 bg-red-50 p-3 text-[12.5px] leading-relaxed text-red-900">
        <p>Google에서 이 앱의 권한을 취소하고, 이 컴퓨터에 저장된 계정 정보와 토큰을 지웁니다. 이미 Google에 만든 일정과 전송 기록은 그대로 남습니다.</p>
        <form action={disconnectGoogleAccount}>
          <button type="submit" className="rounded bg-red-700 px-3.5 py-2 text-[13px] font-medium text-white hover:bg-red-600">
            연결 해제 확인
          </button>
        </form>
      </div>
    </details>
  );

  return (
    <div className="grid gap-[18px] lg:grid-cols-[minmax(0,1fr)_340px]">
      <div className="flex min-w-0 flex-col gap-4">
        <div>
          <h1 className="text-[21px] font-semibold">설정</h1>
          <p className="mt-0.5 text-[12.5px] text-ink-600">중요 단어와 채팅방 데이터를 관리합니다. 모두 이 컴퓨터에만 저장되고 외부로 보내지 않습니다.</p>
        </div>

        <section className="flex flex-col gap-3 rounded-lg border border-slate-200 bg-white p-5 text-sm" aria-label="중요 단어">
          <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
            <h2 className="text-base font-semibold">★ 중요 단어</h2>
            <span className="text-xs text-ink-500">제목에 이 단어가 들어간 후보·일정에 ★ 표시가 붙고, 모아 보거나 Google에 먼저 보낼 수 있습니다</span>
          </div>

          {keywords.length === 0 ? (
            <p className="rounded border border-dashed border-slate-300 p-3 text-ink-500">아직 중요 단어가 없습니다.</p>
          ) : (
            <ul className="flex flex-wrap gap-2">
              {keywords.map((keyword) => {
                const counts = reach.get(keyword.id)!;
                const excluded = counts.excludedCandidates + counts.excludedEvents;
                return (
                  <li
                    key={keyword.id}
                    className="flex items-center gap-2 rounded-full bg-amber-100 py-1.5 pl-3 pr-1.5 text-[13px] font-medium text-amber-900"
                    title={`제목 일치: 후보 ${counts.candidates}건 · 캘린더 ${counts.events}건${excluded > 0 ? ` (이 중 직접 제외 ${excluded}건)` : ""}`}
                  >
                    {keyword.keyword}
                    <span className="font-display text-[11.5px] font-normal opacity-70">{counts.candidates.toLocaleString()}</span>
                    <form action={removeImportantKeyword}>
                      <input type="hidden" name="id" value={keyword.id} />
                      <button
                        type="submit"
                        className="flex h-5 w-5 items-center justify-center rounded-full text-amber-900/60 hover:bg-amber-200 hover:text-amber-950"
                        aria-label={`${keyword.keyword} 삭제`}
                      >
                        ×
                      </button>
                    </form>
                  </li>
                );
              })}
            </ul>
          )}

          <KeywordForm minLength={KEYWORD_MIN_LENGTH} maxLength={KEYWORD_MAX_LENGTH} />
          <p className="text-xs text-ink-500">
            단어 하나는 공백을 빼고 {KEYWORD_MIN_LENGTH}~{KEYWORD_MAX_LENGTH}자, 최대 {MAX_KEYWORDS}개(현재 {keywords.length}개). 알약의 숫자는 제목이 일치하는
            후보 수입니다. 직접 ★ 지정한 일정 {overrides.important.toLocaleString()}건과 &ldquo;중요 아님&rdquo;으로 지정한 {overrides.notImportant.toLocaleString()}
            건은 단어와 상관없이 유지됩니다.{" "}
            <Link href="/candidates?status=ALL&importance=important" className="text-ark-700 hover:underline">
              중요 후보 보기 →
            </Link>
          </p>
        </section>

        <section className="overflow-hidden rounded-lg border border-slate-200 bg-white text-sm" aria-label="채팅방 데이터">
          <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1 border-b border-slate-200 px-4 py-3">
            <h2 className="text-base font-semibold">채팅방 데이터</h2>
            <span className="text-xs text-ink-500">{chats.length}개 채팅방</span>
            <span className="basis-full text-xs text-ink-500">
              <code>data/bypp.db</code>에 저장된 채팅방별 데이터입니다. 삭제하면 업로드 기록·메시지·일정 후보·캘린더 일정·Google 전송 기록이 한 번에 지워지고, 직전에
              전체 DB 백업을 <code>data/backups</code>에 남깁니다. Google 캘린더에 이미 만든 일정은 지우지 않습니다.
            </span>
          </div>
          {deleted && (
            <p className="m-3 rounded border border-emerald-200 bg-emerald-50 p-2.5 text-emerald-900" role="status">
              채팅방 데이터를 삭제했습니다: 메시지 {Number(deleted[1]).toLocaleString()}건 · 후보 {Number(deleted[2]).toLocaleString()}건 · 캘린더 일정{" "}
              {Number(deleted[3]).toLocaleString()}건. 삭제 전 백업은 data/backups에 있습니다.
            </p>
          )}
          {chatError && (
            <p className="m-3 rounded border border-red-200 bg-red-50 p-2.5 text-red-800" role="alert">
              {chatError}
            </p>
          )}
          {chats.length === 0 ? (
            <p className="m-3 rounded border border-dashed border-slate-300 p-3 text-ink-500">저장된 채팅방 데이터가 없습니다.</p>
          ) : (
            <div className="overflow-x-auto">
              <div className="min-w-[520px]">
                <div className={`${TABLE} border-b border-slate-200 bg-slate-50 px-4 py-2 text-[11.5px] font-medium text-ink-500`}>
                  <span>채팅방</span>
                  <span className="text-right">메시지</span>
                  <span className="text-right">후보</span>
                  <span className="text-right">일정</span>
                  <span className="text-right">Google 전송</span>
                </div>
                <ul className="divide-y divide-slate-100">
                  {chats.map(({ key, title, filenames, counts }) => (
                    <li key={key} className="px-4 py-3">
                      <div className={TABLE}>
                        <div className="min-w-0">
                          <p className="break-words text-[13.5px] font-medium">{title}</p>
                          <p className="truncate text-[11.5px] text-ink-500" title={filenames.join(", ")}>
                            {filenames.join(", ") || "업로드 기록 없음"} · 업로드 {counts.imports}회
                          </p>
                        </div>
                        <span className="text-right font-display text-[13px]">{counts.messages.toLocaleString()}</span>
                        <span className="text-right font-display text-[13px]">{counts.candidates.toLocaleString()}</span>
                        <span className="text-right font-display text-[13px]">{counts.events.toLocaleString()}</span>
                        <span className={`text-right font-display text-[13px] ${counts.googleSynced > 0 ? "text-emerald-700" : ""}`}>{counts.googleSynced.toLocaleString()}</span>
                      </div>
                      <details className="group mt-1.5">
                        <summary className="cursor-pointer list-none text-xs text-red-700 hover:underline [&::-webkit-details-marker]:hidden">이 채팅방 데이터 삭제…</summary>
                        <div className="mt-2 flex flex-col gap-2 rounded border border-red-200 bg-red-50 px-3.5 py-3 text-[12.5px] leading-relaxed text-red-900">
                          <p className="text-[13px] font-medium text-red-800">이 채팅방 데이터를 삭제할까요?</p>
                          <p>
                            &ldquo;{title}&rdquo;의 메시지 {counts.messages.toLocaleString()}건, 일정 후보 {counts.candidates.toLocaleString()}건, 캘린더 일정{" "}
                            {counts.events.toLocaleString()}건과 업로드 기록 {counts.imports}건이 함께 지워집니다. 되돌리려면 data/backups의 백업 파일로 DB를 바꿔야
                            합니다.
                          </p>
                          {counts.googleSynced > 0 && (
                            <p className="font-medium">
                              Google에 보낸 일정 {counts.googleSynced}건은 Google 캘린더에 그대로 남습니다. 같은 파일을 다시 올려 다시 보내면 Google에 일정이 하나 더
                              생깁니다.
                            </p>
                          )}
                          <form action={deleteChat}>
                            <input type="hidden" name="key" value={key} />
                            <input type="hidden" name="imports" value={counts.imports} />
                            <input type="hidden" name="messages" value={counts.messages} />
                            <input type="hidden" name="candidates" value={counts.candidates} />
                            <input type="hidden" name="events" value={counts.events} />
                            <button type="submit" className="rounded bg-red-700 px-3.5 py-2 text-[13px] font-medium text-white hover:bg-red-600">
                              삭제 확인
                            </button>
                          </form>
                        </div>
                      </details>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          )}
        </section>
      </div>

      <aside className="flex flex-col gap-3.5" aria-label="연결과 추출 방식">
        <section className="flex flex-col gap-2.5 rounded-lg border border-slate-200 bg-white p-[18px] text-sm" aria-label="Google 연결">
          <h2 className="text-[15px] font-semibold">Google 연결</h2>
          {googleFlash && (
            <p className={`rounded border p-2 text-[12.5px] leading-relaxed ${googleFlash.ok ? "border-emerald-200 bg-emerald-50 text-emerald-900" : "border-amber-200 bg-amber-50 text-amber-900"}`} role="status">
              {googleFlash.text}
            </p>
          )}
          {connection.state === "connected" ? (
            <>
              <p className="flex flex-wrap items-center gap-2">
                <span className="rounded-[3px] bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800">연결됨</span>
                <span className="text-[12.5px] text-ink-600">{connection.email ?? "(이메일 비공개)"}</span>
              </p>
              <p className="text-[12.5px] leading-relaxed text-ink-600">
                기본 캘린더에 생성합니다. 생성한 일정은 같은 계정을 쓰는 휴대폰 기본 캘린더 앱에도 나타납니다. 연결만으로는 아무것도 보내지 않습니다.
              </p>
              <p className="text-[11.5px] leading-relaxed text-ink-500">
                이 표시는 이 앱에 저장된 기록입니다. Google 계정에서 직접 권한을 지웠다면 &ldquo;연결 상태 확인&rdquo;을 눌러야 반영됩니다.
              </p>
              <form action={checkGoogleConnection}>
                <button type="submit" className="w-full rounded border border-slate-300 px-3 py-2 text-[13px] text-slate-700 hover:bg-slate-50">
                  연결 상태 확인
                </button>
              </form>
              {disconnect}
            </>
          ) : connection.state === "not-configured" ? (
            <p className="text-[12.5px] leading-relaxed text-ink-600">
              설정 미완료 — <code>.env.local</code>에 <code>GOOGLE_CLIENT_ID</code>, <code>GOOGLE_CLIENT_SECRET</code>, <code>GOOGLE_REDIRECT_URI</code>가 필요합니다.
            </p>
          ) : (
            <>
              <p className="flex flex-wrap items-center gap-2">
                <span className={`rounded-[3px] px-2 py-0.5 text-xs font-medium ${connection.state === "needs-reconnect" ? "bg-amber-100 text-amber-800" : "bg-slate-100 text-slate-700"}`}>
                  {connection.state === "needs-reconnect" ? "재연결 필요" : "연결 안 됨"}
                </span>
                {connection.state === "needs-reconnect" && connection.email && <span className="text-[12.5px] text-ink-600">{connection.email}</span>}
              </p>
              <p className="text-[12.5px] leading-relaxed text-ink-600">연결하면 고른 일정만 Google 기본 캘린더에 만들 수 있습니다. 연결만으로는 아무것도 보내지 않습니다.</p>
              {/* A plain <a>: this Route Handler starts OAuth and must never be prefetched. */}
              <a href="/api/auth/google" className="rounded bg-slate-900 px-3 py-2 text-center text-[13px] font-medium text-white hover:bg-slate-700">
                {connection.state === "needs-reconnect" ? "Google 다시 연결" : "Google 연결"}
              </a>
              {connection.state === "needs-reconnect" && disconnect}
            </>
          )}
        </section>

        <section id="extraction" className="flex scroll-mt-4 flex-col gap-2.5 rounded-lg border border-slate-200 bg-white p-[18px] text-sm" aria-label="추출 방식">
          <h2 className="text-[15px] font-semibold">추출 방식</h2>
          <p className="flex flex-wrap items-center gap-2">
            <span className={`rounded-[3px] px-2 py-0.5 font-display text-[11.5px] font-medium ${llm ? "bg-amber-200 text-amber-900" : "bg-slate-100 text-slate-700"}`}>
              {llm ? "LLM ON" : "LLM OFF"}
            </span>
            <span className="text-[12.5px] text-ink-600">{llm ? `${llm.provider === "openrouter" ? "OpenRouter/DeepSeek" : "Google Gemini"} 사용` : "규칙 기반 + 저신뢰 추정만 사용"}</span>
          </p>
          <p className="font-display text-[11px] text-ink-500">{describeLlm(llm)}</p>
          <p className="text-[12.5px] leading-relaxed text-ink-600">
            <code>.env.local</code>의 <code>LLM_PROVIDER</code>로 바꿉니다(바꾼 뒤 서버 재시작). 켜면 어떤 내용이 외부로 전달되는지 업로드 화면에 표시됩니다.
          </p>
        </section>

        <AssistantCard variant="bubble" message="중요 단어를 등록해 두면 놓칠 일이 줄어요!" />
      </aside>
    </div>
  );
}

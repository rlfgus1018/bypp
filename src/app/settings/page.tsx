import Link from "next/link";
import { KeywordForm } from "@/components/KeywordForm";
import { listChatData } from "@/lib/data/chat-data";
import { getDb } from "@/lib/db/client";
import { importantKeywordsRepo } from "@/lib/db/repositories/important-keywords";
import { KEYWORD_MAX_LENGTH, KEYWORD_MIN_LENGTH, MAX_KEYWORDS } from "@/lib/importance/keywords";
import { deleteChat, removeImportantKeyword } from "./actions";

export const dynamic = "force-dynamic";

const CHAT_ERROR: Record<string, string> = {
  changed: "그 사이 이 채팅방의 데이터가 바뀌어(업로드·추출 등) 아무것도 삭제하지 않았습니다. 건수를 다시 확인해 주세요.",
  "sync-in-progress": "이 채팅방의 일정 하나가 지금 Google로 전송되는 중이라 아무것도 삭제하지 않았습니다. 잠시 후 다시 시도해 주세요.",
  "unknown-chat": "그 채팅방의 데이터를 찾을 수 없습니다. 이미 삭제되었을 수 있습니다.",
  invalid: "요청이 올바르지 않아 아무것도 삭제하지 않았습니다.",
};

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

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold">설정</h1>
      </div>

      <section className="space-y-3 rounded-lg border border-slate-200 bg-white p-4 text-sm">
        <div>
          <h2 className="font-semibold">중요 일정</h2>
          <p className="mt-1 text-xs text-slate-500">
            <strong>제목</strong>에 중요 단어가 들어간 일정 후보와 캘린더 일정은 &ldquo;★ 중요&rdquo;로 모아 볼 수 있고, Google에는 중요 일정만 골라 보낼 수 있습니다. 단어를 추가하거나 지우면
            이미 추출된 후보와 일정에도 바로 적용됩니다. 중요 단어는 이 컴퓨터에만 저장되고 외부로 보내지 않습니다.
          </p>
        </div>

        {keywords.length === 0 ? (
          <p className="rounded border border-dashed border-slate-300 p-3 text-slate-500">아직 중요 단어가 없습니다.</p>
        ) : (
          <ul className="divide-y divide-slate-100 rounded border border-slate-200">
            {keywords.map((keyword) => {
              const counts = reach.get(keyword.id)!;
              const excluded = counts.excludedCandidates + counts.excludedEvents;
              return (
                <li key={keyword.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2">
                  <span className="rounded-full bg-amber-100 px-2.5 py-0.5 font-medium text-amber-900">★ {keyword.keyword}</span>
                  <span className="text-xs tabular-nums text-slate-500">
                    제목 일치: 후보 {counts.candidates.toLocaleString()}건 · 캘린더 {counts.events.toLocaleString()}건
                    {excluded > 0 ? ` (이 중 직접 제외 ${excluded.toLocaleString()}건)` : ""}
                  </span>
                  <form action={removeImportantKeyword} className="ml-auto">
                    <input type="hidden" name="id" value={keyword.id} />
                    <button type="submit" className="rounded border border-slate-300 px-2 py-0.5 text-xs text-slate-600 hover:bg-slate-50" aria-label={`${keyword.keyword} 삭제`}>
                      삭제
                    </button>
                  </form>
                </li>
              );
            })}
          </ul>
        )}

        <KeywordForm minLength={KEYWORD_MIN_LENGTH} maxLength={KEYWORD_MAX_LENGTH} />
        <p className="text-xs text-slate-500">
          단어 하나는 공백을 빼고 {KEYWORD_MIN_LENGTH}~{KEYWORD_MAX_LENGTH}자, 최대 {MAX_KEYWORDS}개까지 등록할 수 있습니다 (현재 {keywords.length}개).
        </p>

        <div className="border-t border-slate-100 pt-3 text-xs text-slate-600">
          직접 지정: 중요로 고정 {overrides.important.toLocaleString()}건 · 중요 아님으로 고정 {overrides.notImportant.toLocaleString()}건. 후보 카드나 캘린더 일정에서 &ldquo;중요로 /
          중요 아님 / 자동&rdquo;으로 바꿀 수 있고, 단어를 지워도 직접 지정은 남습니다.{" "}
          <Link href="/candidates?status=ALL&importance=important" className="underline">
            중요 후보 보기
          </Link>
        </div>
      </section>

      <section className="space-y-3 rounded-lg border border-slate-200 bg-white p-4 text-sm" aria-label="채팅방 데이터">
        <div>
          <h2 className="font-semibold">채팅방 데이터</h2>
          <p className="mt-1 text-xs text-slate-500">
            이 컴퓨터(<code>data/bypp.db</code>)에 저장된 채팅방별 데이터입니다. 삭제하면 그 채팅방의 업로드 기록·메시지·일정 후보·캘린더 일정·Google 전송 기록이 한
            번에 지워집니다. 삭제 직전에 전체 DB 백업을 <code>data/backups</code>에 남깁니다. Google 캘린더에 이미 만든 일정은 지우지 않습니다.
          </p>
        </div>
        {deleted && (
          <p className="rounded border border-emerald-200 bg-emerald-50 p-2 text-emerald-900" role="status">
            채팅방 데이터를 삭제했습니다: 메시지 {Number(deleted[1]).toLocaleString()}건 · 후보 {Number(deleted[2]).toLocaleString()}건 · 캘린더 일정{" "}
            {Number(deleted[3]).toLocaleString()}건. 삭제 전 백업은 data/backups에 있습니다.
          </p>
        )}
        {chatError && (
          <p className="rounded border border-red-200 bg-red-50 p-2 text-red-800" role="alert">
            {chatError}
          </p>
        )}
        {chats.length === 0 ? (
          <p className="rounded border border-dashed border-slate-300 p-3 text-slate-500">저장된 채팅방 데이터가 없습니다.</p>
        ) : (
          <ul className="divide-y divide-slate-100 rounded border border-slate-200">
            {chats.map(({ key, title, filenames, counts }) => (
              <li key={key} className="px-3 py-2">
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <span className="font-medium">{title}</span>
                  <span className="text-xs tabular-nums text-slate-500">
                    업로드 {counts.imports} · 메시지 {counts.messages.toLocaleString()} · 후보 {counts.candidates.toLocaleString()} · 캘린더 일정{" "}
                    {counts.events.toLocaleString()} · Google 전송 {counts.googleSynced.toLocaleString()}
                  </span>
                </div>
                {filenames.length > 0 && <p className="mt-0.5 break-words text-xs text-slate-400">{filenames.join(", ")}</p>}
                <details className="mt-1">
                  <summary className="cursor-pointer text-xs text-red-700">이 채팅방 데이터 삭제…</summary>
                  <div className="mt-2 rounded border border-red-200 bg-red-50 p-3 text-xs text-red-900">
                    <p>
                      &ldquo;{title}&rdquo;의 메시지 {counts.messages.toLocaleString()}건, 일정 후보 {counts.candidates.toLocaleString()}건, 캘린더 일정{" "}
                      {counts.events.toLocaleString()}건과 업로드 기록 {counts.imports}건을 삭제합니다. 되돌리려면 data/backups의 백업 파일로 DB를 바꿔야 합니다.
                    </p>
                    {counts.googleSynced > 0 && (
                      <p className="mt-1 font-medium">
                        Google에 보낸 일정 {counts.googleSynced}건은 Google 캘린더에 그대로 남습니다. 같은 파일을 다시 올려 다시 보내면 Google에 일정이 하나 더
                        생깁니다.
                      </p>
                    )}
                    <form action={deleteChat} className="mt-2">
                      <input type="hidden" name="key" value={key} />
                      <input type="hidden" name="imports" value={counts.imports} />
                      <input type="hidden" name="messages" value={counts.messages} />
                      <input type="hidden" name="candidates" value={counts.candidates} />
                      <input type="hidden" name="events" value={counts.events} />
                      <button type="submit" className="rounded bg-red-700 px-3 py-1.5 font-medium text-white">
                        삭제 확인
                      </button>
                    </form>
                  </div>
                </details>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

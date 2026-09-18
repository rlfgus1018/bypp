import Link from "next/link";
import { KeywordForm } from "@/components/KeywordForm";
import { getDb } from "@/lib/db/client";
import { importantKeywordsRepo } from "@/lib/db/repositories/important-keywords";
import { KEYWORD_MAX_LENGTH, KEYWORD_MIN_LENGTH, MAX_KEYWORDS } from "@/lib/importance/keywords";
import { removeImportantKeyword } from "./actions";

export const dynamic = "force-dynamic";

// Rendering only reads. Keywords are added / removed by ./actions.ts.
export default function SettingsPage() {
  const repo = importantKeywordsRepo(getDb());
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
    </div>
  );
}

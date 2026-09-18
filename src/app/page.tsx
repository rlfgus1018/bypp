import { UploadForm } from "@/components/UploadForm";
import { chatTitleOf } from "@/lib/candidates/source-group";
import { getDb } from "@/lib/db/client";
import { importsRepo } from "@/lib/db/repositories/imports";
import { messagesRepo } from "@/lib/db/repositories/messages";
import { describeLlm, resolveLlmConfig } from "@/lib/schedule/factory";

export const dynamic = "force-dynamic";

export default function HomePage() {
  const db = getDb();
  const statuses = messagesRepo(db).countByStatus();
  const recent = importsRepo(db).listRecent(5);
  // Computed on the server; only this plain string (never the key) reaches the browser.
  const llm = resolveLlmConfig();
  const llmLabel = describeLlm(llm);
  const providerLabel = llm?.provider === "openrouter" ? "OpenRouter/DeepSeek" : "Google Gemini";

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">KakaoTalk 대화 가져오기</h1>
        <p className="mt-1 text-sm text-slate-500">
          내보낸 대화 파일에서 일정 후보를 찾아 검토 목록에 추가합니다. 캘린더에는 아무것도 등록하지 않습니다.
        </p>
      </div>

      <div className={`rounded-lg border p-3 text-sm ${llm ? "border-amber-300 bg-amber-50" : "border-slate-200 bg-white"}`}>
        <p className="font-mono text-xs">{llmLabel}</p>
        {llm ? (
          <p className="mt-2 text-amber-900">
            ⚠ {providerLabel} API가 활성화되어 있습니다. 일정 해석이 필요한 일부 카카오톡 메시지(전화번호·이메일·URL 마스킹, 보낸 사람 제외
            {llm.batchSize > 1 ? `, 같은 방의 메시지를 한 요청에 최대 ${llm.batchSize}건씩` : ""})가
            외부 {providerLabel} API로 전송될 수 있습니다. 실제 개인/타인의 대화 데이터를 전송하기 전에 선택한 공급자의 최신 데이터 처리 정책을 확인하세요.
          </p>
        ) : (
          <p className="mt-1 text-slate-500">
            모든 처리가 이 컴퓨터 안에서 이루어집니다. 상대 날짜·변경·취소 같은 애매한 메시지는 저신뢰 heuristic으로 추출됩니다.
          </p>
        )}
      </div>

      <UploadForm
        initialOverall={{ extracted: statuses.EXTRACTED ?? 0, failed: statuses.FAILED ?? 0, pending: statuses.PENDING_EXTRACTION ?? 0 }}
        llmEnabled={llm !== null}
        llmPlan={{ batchSize: llm?.batchSize ?? 1, rpm: llm?.rpm ?? 0, concurrency: llm?.concurrency ?? 1 }}
      />

      {recent.length > 0 && (
        <section>
          <h2 className="text-sm font-semibold text-slate-700">최근 가져오기</h2>
          <ul className="mt-2 divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white text-sm">
            {recent.map((item) => (
              <li key={item.id} className="flex flex-wrap justify-between gap-2 px-3 py-2">
                <span className="min-w-0 break-words" title={item.filename}>
                  {chatTitleOf({ filename: item.filename, importRoomName: item.roomName, messageRoomName: null }).title}
                </span>
                <span className="tabular-nums text-slate-500">
                  {item.rangeFrom || item.rangeTo ? `기간 ${item.rangeFrom ?? "처음"}~${item.rangeTo ?? "끝"} · ` : ""}
                  신규 {item.newMessages.toLocaleString()} · 중복 {item.duplicateMessages.toLocaleString()} · 추출 대상{" "}
                  {item.detectedCount.toLocaleString()}
                  {item.outOfRangeCount > 0 ? ` · 기간 밖 보류 ${item.outOfRangeCount.toLocaleString()}` : ""} ·{" "}
                  {item.createdAt.slice(0, 16).replace("T", " ")} UTC
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

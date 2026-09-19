import Link from "next/link";
import type { ConnectionView } from "@/lib/google/connection";

const REASON_TEXT: Record<string, string> = {
  revoked: "Google에서 연결이 해제되었거나 만료되었습니다.",
  scope_missing: "캘린더 일정 생성 권한이 허용되지 않았습니다. 동의 화면에서 캘린더 권한을 체크해 주세요.",
  no_refresh_token: "지속 연결에 필요한 토큰을 받지 못했습니다. 다시 동의해 주세요.",
  token_unreadable: "저장된 토큰을 읽을 수 없습니다(암호화 키가 바뀌었을 수 있습니다).",
  unknown: "연결 상태를 확인할 수 없습니다.",
};

// Result codes the OAuth callback (and the remove action) may put in ?google=. Anything else is ignored.
const FLASH: Record<string, { tone: "ok" | "warn" | "error"; text: string }> = {
  connected: { tone: "ok", text: "Google 계정을 연결했습니다. 일정은 직접 보낼 때만 생성됩니다." },
  denied: { tone: "warn", text: "Google 연결을 취소했습니다. 아무것도 바뀌지 않았습니다." },
  missing_code: { tone: "error", text: "Google에서 인증 코드를 받지 못했습니다. 다시 시도해 주세요." },
  bad_state: { tone: "error", text: "연결 요청을 확인할 수 없습니다(만료되었거나 이미 사용된 요청). 다시 시도해 주세요." },
  exchange_failed: { tone: "error", text: "Google과 토큰을 교환하지 못했습니다. 다시 시도해 주세요." },
  identity_failed: { tone: "error", text: "Google 계정을 확인하지 못했습니다. 다시 시도해 주세요." },
  scope_missing: { tone: "error", text: "캘린더 일정 생성 권한이 허용되지 않아 연결을 완료하지 못했습니다." },
  no_refresh_token: { tone: "error", text: "지속 연결에 필요한 토큰을 받지 못했습니다. 다시 연결해 주세요." },
  other_account: { tone: "error", text: "이미 다른 Google 계정으로 일정을 보낸 기록이 있어, 계정을 바꾸지 않았습니다." },
  network: { tone: "error", text: "Google에 연결하지 못했습니다. 네트워크를 확인해 주세요." },
  not_configured: { tone: "error", text: "Google 연동 환경변수가 설정되지 않았습니다." },
  busy: { tone: "warn", text: "이 일정은 지금 Google로 전송되는 중이라 제거하지 않았습니다. 잠시 후 다시 시도해 주세요." },
};

const TONE = {
  ok: "border-emerald-200 bg-emerald-50 text-emerald-900",
  warn: "border-amber-200 bg-amber-50 text-amber-900",
  error: "border-red-200 bg-red-50 text-red-800",
};

// A plain <a>, not <Link>: the target is a Route Handler that starts OAuth, and must never be prefetched.
function ConnectLink({ label }: { label: string }) {
  return (
    <a href="/api/auth/google" className="rounded bg-slate-900 px-3.5 py-1.5 text-[12.5px] font-medium text-white hover:bg-slate-700">
      {label}
    </a>
  );
}

/** Connection status only. Receives a ConnectionView: no token, secret or account id ever reaches a component. */
export function GoogleConnectionCard({
  connection,
  flash,
  sendableCount,
  importantSendableCount,
}: {
  connection: ConnectionView;
  flash: string | null;
  /** local events that could be created on Google right now (from the local database; Google is not asked) */
  sendableCount: number;
  /** of those, the important ones — the bulk page opens on "important only" */
  importantSendableCount: number;
}) {
  const note = flash ? FLASH[flash] : undefined;
  return (
    <section
      className={`rounded-md border bg-white px-3.5 py-2.5 text-[12.5px] ${connection.state === "connected" ? "border-emerald-200" : connection.state === "needs-reconnect" ? "border-amber-300" : "border-slate-200"}`}
      aria-label="Google 캘린더 연결"
    >
      {note && (
        <p className={`mb-2 rounded border p-2 ${TONE[note.tone]}`} role="status">
          {note.text}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
        <span className={`font-medium ${connection.state === "connected" ? "text-emerald-800" : ""}`}>
          Google 캘린더{connection.state === "connected" ? " · 연결됨" : ""}
        </span>
        {connection.state === "not-configured" && (
          <span className="text-slate-500">
            설정 미완료 — <code>.env.local</code>에 <code>GOOGLE_CLIENT_ID</code>, <code>GOOGLE_CLIENT_SECRET</code>, <code>GOOGLE_REDIRECT_URI</code>
            가 필요합니다.
          </span>
        )}
        {connection.state === "not-connected" && (
          <>
            <span className="text-slate-500">연결되지 않음</span>
            <ConnectLink label="Google 연결" />
          </>
        )}
        {connection.state === "connected" && (
          <>
            <span className="text-ink-600">{connection.email ?? "(이메일 비공개)"} 의 기본 캘린더</span>
            {/* a page to review and untick first — following this link sends nothing */}
            <span className="ml-auto flex flex-wrap items-center gap-2">
              <Link
                href="/calendar/google?scope=important"
                className="rounded border border-amber-500 px-3.5 py-1.5 font-medium text-amber-800 hover:bg-amber-50"
              >
                ★ 중요 일정 Google로 보내기 ({importantSendableCount.toLocaleString()}건)
              </Link>
              <Link href="/calendar/google?scope=all" className="text-xs text-ink-500 hover:underline">
                전체 {sendableCount.toLocaleString()}건
              </Link>
            </span>
          </>
        )}
        {connection.state === "needs-reconnect" && (
          <>
            <span className="rounded-[3px] bg-amber-100 px-2 py-0.5 text-[11.5px] font-medium text-amber-800">재연결 필요</span>
            <span className="text-slate-600">
              {connection.email ? `${connection.email} · ` : ""}
              {REASON_TEXT[connection.reason]}
            </span>
            <ConnectLink label="Google 다시 연결" />
          </>
        )}
      </div>
      {connection.state !== "connected" && (
        <p className="mt-1 text-[11.5px] text-ink-500">연결만으로는 아무것도 전송되지 않습니다. 직접 고른 일정만 생성됩니다.</p>
      )}
    </section>
  );
}

import Image from "next/image";
import Link from "next/link";

export type ChatOption = {
  key: string;
  title: string;
  counts: { PENDING: number; APPROVED: number; IGNORED: number };
  /** important candidates of this chat (any status) */
  important: number;
};

/**
 * Which chat's candidates to review — a navy side panel of plain links (?source=…), so the choice lives in
 * the URL and keeps the tab, the search conditions and the importance scope. Below it, the important words.
 */
export function ChatSidebar({
  chats,
  selected,
  hrefFor,
  keywords,
  totalCandidates,
}: {
  chats: ChatOption[];
  /** "" = all chats */
  selected: string;
  hrefFor: (source: string) => string;
  keywords: string[];
  totalCandidates: number;
}) {
  return (
    <aside className="flex flex-col gap-2.5 rounded-lg bg-navy-950 px-4 py-[18px] lg:min-h-[640px]" aria-label="채팅방 선택">
      <span className="font-display text-[10.5px] font-medium tracking-[0.2em] text-ark-300">채팅방 선택</span>
      <nav className="flex flex-col gap-2.5">
        {chats.map((chat) => {
          const active = chat.key === selected;
          return active ? (
            <Link
              key={chat.key}
              href={hrefFor(chat.key)}
              aria-current="page"
              className="relative flex flex-col gap-1.5 rounded-[3px] bg-ark-700 py-3 pl-4 pr-3"
            >
              <span className="absolute bottom-[11px] left-0 top-[11px] w-[3px] bg-white" aria-hidden />
              <span className="break-words text-[13px] font-medium leading-snug text-white">{chat.title}</span>
              <span className="flex flex-wrap gap-1.5 text-[11px]">
                <span className="rounded-[2px] bg-white px-2 py-0.5 font-display font-semibold text-ark-700">대기 {chat.counts.PENDING.toLocaleString()}</span>
                <span className="rounded-[2px] bg-white/20 px-2 py-0.5 font-medium text-white">승인 {chat.counts.APPROVED.toLocaleString()}</span>
                {chat.important > 0 && <span className="rounded-[2px] bg-amber-400 px-2 py-0.5 font-semibold text-amber-950">★ {chat.important.toLocaleString()}</span>}
              </span>
            </Link>
          ) : (
            <Link key={chat.key} href={hrefFor(chat.key)} className="flex flex-col gap-1 rounded-[3px] border border-white/20 p-3 hover:bg-white/5">
              <span className="break-words text-[13px] leading-snug text-mist-100">{chat.title}</span>
              <span className="text-[11.5px] text-mist-300">
                대기 {chat.counts.PENDING.toLocaleString()} · 승인 {chat.counts.APPROVED.toLocaleString()} · 무시 {chat.counts.IGNORED.toLocaleString()}
                {chat.important > 0 ? ` · ★ ${chat.important.toLocaleString()}` : ""}
              </span>
            </Link>
          );
        })}
        <Link
          href={hrefFor("")}
          aria-current={selected === "" ? "page" : undefined}
          className={`rounded-[3px] border px-2.5 py-2.5 text-center text-[13px] font-medium ${
            selected === "" ? "border-ark-300 bg-ark-300/15 text-white" : "border-ark-300/55 text-ark-300 hover:bg-white/5"
          }`}
        >
          전체 채팅방 보기 <span className="font-display opacity-80">{totalCandidates.toLocaleString()}</span>
        </Link>
      </nav>

      <Link href="/settings" className="mt-1.5 flex flex-col gap-1 rounded-[3px] border border-amber-400/45 bg-amber-400/15 p-3 hover:bg-amber-400/20">
        <span className="text-[12.5px] font-medium text-amber-300">★ 중요 단어</span>
        <span className="text-[11.5px] leading-relaxed text-amber-100">{keywords.length > 0 ? keywords.join(" · ") : "아직 없음 — 등록하면 관련 후보에 ★가 붙습니다"}</span>
        <span className="text-[11.5px] text-amber-300">중요 단어 설정 →</span>
      </Link>

      <div className="flex-1" />
      <Image
        src="/assets/upperbody1.png"
        alt=""
        width={1254}
        height={1254}
        sizes="180px"
        className="pointer-events-none -mb-2 hidden w-[180px] select-none self-center lg:block"
      />
    </aside>
  );
}

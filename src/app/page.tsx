import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";

export const metadata: Metadata = {
  title: "ARK:U — 카카오톡 공지에서 일정 정리",
  description: "카카오톡 단체방 공지에서 일정만 골라 정리하는 개인용 도구. 시작 가이드: 대화 내보내기 → 업로드 → 검토.",
};

// The landing page (/). Static: no database, nothing sent anywhere. The app chrome (header, banner) is left out
// by AppFrame; the app itself starts at /upload.
//
// One call to action, one name: "시작하기" (→ /upload) — in the sticky header, in the hero, and at the step of the
// guide where the user actually needs it. Everything else on the page is the three-step start guide.

const MOBILE_STEPS = [
  { image: "/assets/mobile1.jpg", title: "채팅방 오른쪽 위 메뉴(≡) → 설정(⚙)", alt: "카카오톡 채팅방 메뉴 화면", position: "object-top" },
  { image: "/assets/mobile2.jpg", title: "‘대화 내용 내보내기’ 선택", alt: "채팅방 설정의 대화 내용 내보내기 항목", position: "object-bottom" },
  {
    image: "/assets/mobile3.jpg",
    title: "‘텍스트 메시지만 저장’ → 메일 등으로 받기",
    alt: "대화 내용 내보내기 방식 선택 화면",
    position: "object-top",
  },
];

const PC_STEPS = [
  { image: "/assets/pc1.jpg", width: 223, height: 310, title: "채팅방 오른쪽 아래 ⚙ → ‘대화 내용’", alt: "PC 카카오톡 채팅방 설정 메뉴" },
  { image: "/assets/pc2.jpg", width: 169, height: 101, title: "‘대화 내보내기’ (Ctrl+S)", alt: "대화 내보내기 하위 메뉴" },
  { image: "/assets/pc3.jpg", width: 391, height: 312, title: ".txt 파일로 저장", alt: "대화 내용 메뉴 전체 모습" },
];

const FAQ = [
  { q: "Google 캘린더가 자동으로 바뀌나요?", a: "아니요. Google에는 직접 고른 일정만 보냅니다." },
  { q: "날짜를 못 찾은 후보는요?", a: "‘날짜 미확정’으로 모이고, 캘린더에서 날짜를 넣을 수 있습니다." },
  { q: "놓치면 안 되는 공지가 있어요", a: "중요 단어를 등록하면 해당 일정에 ★가 붙어 모아 볼 수 있습니다." },
];

const START_LABEL = "시작하기";

function Eyebrow({ children, dark = false }: { children: React.ReactNode; dark?: boolean }) {
  return <span className={`font-display text-[11px] font-medium tracking-[0.2em] ${dark ? "text-ark-300" : "text-ark-700"}`}>{children}</span>;
}

/** One numbered step of the start guide: a big number rail on the left, the content on the right. */
function GuideStep({ id, n, title, summary, children }: { id?: string; n: number; title: string; summary: string; children: React.ReactNode }) {
  return (
    <li id={id} className="grid scroll-mt-20 gap-x-5 gap-y-3 sm:grid-cols-[56px_minmax(0,1fr)]">
      <span
        className="flex h-12 w-12 items-center justify-center rounded-full bg-navy-950 font-display text-xl font-bold text-ark-300 sm:h-14 sm:w-14"
        aria-hidden
      >
        {n}
      </span>
      <div className="flex min-w-0 flex-col gap-3.5">
        <div>
          <h3 className="text-[19px] font-semibold">
            <span className="sr-only">{n}단계: </span>
            {title}
          </h3>
          <p className="mt-0.5 text-[13.5px] text-ink-600">{summary}</p>
        </div>
        {children}
      </div>
    </li>
  );
}

function ShotNumber({ n }: { n: number }) {
  return (
    <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-ark-500 font-display text-[11px] font-bold text-white">
      {n}
    </span>
  );
}

const deviceSummary =
  "flex cursor-pointer list-none items-center gap-2 px-4 py-3 text-sm font-semibold [&::-webkit-details-marker]:hidden after:ml-auto after:text-xs after:font-normal after:text-ink-500 after:content-['펼치기'] group-open:after:content-['접기']";

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex min-h-[62px] max-w-[1280px] flex-wrap items-center gap-x-6 gap-y-2 px-4 py-2 sm:px-10">
          <Link href="/" className="flex items-center gap-2.5">
            <span className="block h-4 w-4 rotate-45 bg-navy-950" aria-hidden />
            <span className="font-display text-[17px] font-semibold tracking-[0.1em]">ARK:U</span>
          </Link>
          <div className="flex-1" />
          <nav className="hidden gap-5 text-[13.5px] text-ink-600 sm:flex" aria-label="안내 목차">
            <a href="#guide" className="hover:text-slate-900">
              시작 가이드
            </a>
            <a href="#faq" className="hover:text-slate-900">
              자주 묻는 질문
            </a>
          </nav>
          <Link href="/upload" className="rounded bg-slate-900 px-4 py-2 text-[13.5px] font-semibold text-white hover:bg-slate-700">
            {START_LABEL}
          </Link>
        </div>
      </header>

      <main>
        <section className="relative overflow-hidden bg-gradient-to-r from-navy-950 via-navy-700 to-ark-500 px-4 pt-12 sm:px-10">
          <div className="hud-grid absolute inset-0" aria-hidden />
          <div className="relative mx-auto grid max-w-[1200px] items-end gap-8 md:grid-cols-[minmax(0,1fr)_372px]">
            <div className="flex flex-col gap-4 pb-12">
              <Eyebrow dark>KAKAOTALK → 일정 후보 → 내 캘린더</Eyebrow>
              <h1 className="text-[30px] font-semibold leading-snug text-white [text-wrap:pretty] sm:text-[38px]">
                단체방 공지에서 일정만
                <br />
                골라 정리하는 개인용 도구
              </h1>
              <p className="max-w-[560px] text-[15.5px] leading-[1.75] text-mist-100">
                대화 파일을 올리면 일정을 찾아 드립니다. 승인한 일정만 캘린더에 남습니다.
              </p>
              <div className="mt-1.5 flex flex-wrap items-center gap-3">
                <Link
                  href="/upload"
                  className="rounded bg-white px-5 py-3 text-[15px] font-semibold text-navy-950 shadow-[0_3px_0_rgb(0_0_0/0.25)] hover:bg-mist-100"
                >
                  {START_LABEL}
                </Link>
                <a href="#guide" className="rounded border border-white/50 px-5 py-3 text-[15px] text-white hover:bg-white/10">
                  처음이라면 · 3단계 가이드 ↓
                </a>
              </div>
            </div>
            <Image
              src="/assets/standing1.png"
              alt="ARK:U 안내 캐릭터 전신 일러스트"
              width={1024}
              height={1536}
              sizes="372px"
              loading="eager"
              className="mx-auto w-[260px] drop-shadow-[0_12px_30px_rgb(10_25_50/0.35)] md:w-[372px]"
            />
          </div>
        </section>

        <section id="guide" className="mx-auto flex max-w-[1080px] scroll-mt-16 flex-col gap-7 px-4 pb-12 pt-11 sm:px-10">
          <div>
            <div className="flex flex-wrap items-baseline gap-3">
              <Eyebrow>START GUIDE</Eyebrow>
              <h2 className="text-[25px] font-semibold">시작 가이드 · 3단계</h2>
            </div>
            <p className="mt-1.5 text-[13.5px] text-ink-600">
              준비물: 카카오톡(휴대폰 또는 PC)과 일정이 올라오는 단체방 하나. 가입이나 설치는 필요 없습니다.
            </p>
          </div>

          <ol className="flex flex-col gap-9">
            <GuideStep
              id="export"
              n={1}
              title="카카오톡에서 대화 파일 내보내기"
              summary="휴대폰과 PC 중 편한 쪽 하나만 하면 됩니다. 결과는 .txt 또는 .eml 파일 하나입니다."
            >
              <details name="export-device" open className="group rounded-lg border border-slate-200 bg-white">
                <summary className={deviceSummary}>📱 휴대폰에서</summary>
                <ol className="grid gap-4 border-t border-slate-100 p-4 md:grid-cols-3">
                  {MOBILE_STEPS.map((step, index) => (
                    <li key={step.image} className="flex flex-col gap-2">
                      <span className="flex items-start gap-2 text-[13px] font-medium">
                        <ShotNumber n={index + 1} />
                        {step.title}
                      </span>
                      <div className="relative h-[220px] overflow-hidden rounded-md border border-slate-200 bg-black">
                        <Image
                          src={step.image}
                          alt={step.alt}
                          fill
                          sizes="(min-width: 768px) 320px, 100vw"
                          className={`object-cover ${step.position}`}
                        />
                      </div>
                    </li>
                  ))}
                </ol>
                <p className="border-t border-slate-100 px-4 py-2.5 text-[12.5px] text-ink-600">
                  메일로 보냈다면 받은 메일의 <strong className="font-semibold text-slate-900">첨부 파일</strong>을 저장해 두세요.
                </p>
              </details>
              <details name="export-device" className="group rounded-lg border border-slate-200 bg-white">
                <summary className={deviceSummary}>💻 PC 카카오톡에서</summary>
                <ol className="grid gap-4 border-t border-slate-100 p-4 md:grid-cols-3">
                  {PC_STEPS.map((step, index) => (
                    <li key={step.image} className="flex flex-col gap-2">
                      <span className="flex items-start gap-2 text-[13px] font-medium">
                        <ShotNumber n={index + 1} />
                        {step.title}
                      </span>
                      <div className="flex h-[200px] items-center justify-center overflow-hidden rounded-md border border-slate-200 bg-slate-100">
                        <Image src={step.image} alt={step.alt} width={step.width} height={step.height} className="max-h-full w-auto max-w-full" />
                      </div>
                    </li>
                  ))}
                </ol>
              </details>
            </GuideStep>

            <GuideStep n={2} title="파일 올리기" summary="내보낸 파일을 업로드 화면에 끌어다 놓고, 추출할 기간을 고른 뒤 ‘가져오기’를 누릅니다.">
              <div className="flex flex-wrap items-center gap-3 rounded-lg border border-dashed border-[#94c4e8] bg-[#f8fcff] p-4">
                <span
                  className="flex h-[38px] w-[38px] shrink-0 items-center justify-center border border-ark-500 font-display text-[10px] font-semibold text-ark-700"
                  aria-hidden
                >
                  TXT
                </span>
                <span className="min-w-0 flex-1 text-[13px] text-ink-600">올린 파일은 일정 추출에만 쓰고, 설정에서 언제든 지울 수 있습니다.</span>
                <Link
                  href="/upload"
                  className="rounded bg-ark-700 px-5 py-2.5 text-sm font-semibold text-white shadow-[0_3px_0_var(--color-ark-900)] hover:bg-ark-500"
                >
                  {START_LABEL} →
                </Link>
              </div>
            </GuideStep>

            <GuideStep
              n={3}
              title="검토하고 캘린더로"
              summary="찾아낸 일정 후보를 승인하면 캘린더에 들어갑니다. 원하면 Google 캘린더로도 보낼 수 있습니다."
            >
              <ul className="grid gap-3 sm:grid-cols-3">
                {[
                  { title: "일정 후보", body: "원문을 보며 승인 · 무시" },
                  { title: "캘린더", body: "달력에서 확인 · 수정, ★ 중요만 모아 보기" },
                  { title: "Google로 보내기 (선택)", body: "고른 일정만 생성 — 휴대폰 캘린더 알림까지" },
                ].map((item) => (
                  <li key={item.title} className="rounded-lg border border-slate-200 bg-white p-4">
                    <p className="text-sm font-semibold">{item.title}</p>
                    <p className="mt-1 text-[13px] leading-relaxed text-ink-600">{item.body}</p>
                  </li>
                ))}
              </ul>
            </GuideStep>
          </ol>
        </section>

        <section id="faq" className="mx-auto flex max-w-[1080px] scroll-mt-16 flex-col gap-3.5 px-4 pb-12 sm:px-10">
          <div className="flex flex-wrap items-baseline gap-3">
            <Eyebrow>FAQ</Eyebrow>
            <h2 className="text-[25px] font-semibold">자주 묻는 질문</h2>
          </div>
          <dl className="grid gap-3.5 md:grid-cols-3">
            {FAQ.map((item) => (
              <div key={item.q} className="flex flex-col gap-2 rounded-lg border border-slate-200 bg-white p-5">
                <dt className="text-[15px] font-semibold">{item.q}</dt>
                <dd className="text-[13.5px] leading-[1.7] text-ink-600">{item.a}</dd>
              </div>
            ))}
          </dl>
        </section>
      </main>

      <footer className="bg-navy-950 px-4 py-5 sm:px-10">
        <div className="mx-auto flex max-w-[1200px] flex-wrap items-center gap-3.5">
          <span className="block h-3 w-3 rotate-45 bg-ark-300" aria-hidden />
          <span className="font-display text-sm font-semibold tracking-[0.1em] text-white">ARK:U</span>
          <span className="text-[12.5px] text-mist-300">개인용 일정 정리 도구</span>
          <div className="flex-1" />
          <nav className="flex flex-wrap gap-3 text-[12.5px] text-mist-300" aria-label="바닥글">
            <Link href="/privacy" className="hover:text-white">
              개인정보처리방침
            </Link>
            <Link href="/terms" className="hover:text-white">
              이용약관
            </Link>
          </nav>
        </div>
      </footer>
    </div>
  );
}

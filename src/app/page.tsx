import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";

export const metadata: Metadata = {
  title: "ARK:U — 서비스 소개 · 카카오톡 대화 내보내기 방법",
  description: "카카오톡 단체방 공지에서 일정만 골라 정리하는 개인용 도구. 이용 흐름과 대화 내보내기 방법.",
};

// The landing page (/). Static: no database, nothing sent anywhere. The app chrome (header, banner) is left out
// by AppFrame; the app itself starts at /upload.

const STEPS = [
  { title: "대화 가져오기", body: "내보낸 대화 파일을 올립니다." },
  { title: "일정 후보 검토", body: "찾아낸 일정을 승인하거나 무시합니다." },
  { title: "캘린더에서 관리", body: "승인한 일정을 달력에서 보고 고칩니다." },
  { title: "Google로 보내기", body: "고른 일정만 Google 캘린더에 만듭니다." },
  { title: "휴대폰 캘린더에서 확인", body: "휴대폰 캘린더 앱에서 알림까지 받습니다." },
];

const MOBILE_STEPS = [
  {
    image: "/assets/mobile1.jpg",
    title: "채팅방 메뉴에서 설정(⚙) 열기",
    note: "채팅방 오른쪽 위 메뉴 → 톱니바퀴.",
    alt: "카카오톡 채팅방 메뉴 화면",
    position: "object-top",
  },
  {
    image: "/assets/mobile2.jpg",
    title: "대화 내용 내보내기 선택",
    note: "‘채팅방 데이터’ 아래에 있습니다.",
    alt: "채팅방 설정의 대화 내용 내보내기 항목",
    position: "object-bottom",
  },
  {
    image: "/assets/mobile3.jpg",
    title: "텍스트 메시지만 저장",
    note: "메일로 받은 첨부 파일을 그대로 올리면 됩니다.",
    alt: "대화 내용 내보내기 방식 선택 화면",
    position: "object-top",
  },
];

const PC_STEPS = [
  {
    image: "/assets/pc1.jpg",
    width: 223,
    height: 310,
    title: "설정 메뉴에서 ‘대화 내용’",
    note: "채팅방 오른쪽 아래 ⚙ → 대화 내용.",
    alt: "PC 카카오톡 채팅방 설정 메뉴",
  },
  {
    image: "/assets/pc2.jpg",
    width: 169,
    height: 101,
    title: "‘대화 내보내기’ 누르기",
    note: "하위 메뉴의 ‘대화 내보내기’ (Ctrl+S).",
    alt: "대화 내보내기 하위 메뉴",
  },
  {
    image: "/assets/pc3.jpg",
    width: 391,
    height: 312,
    title: "저장한 파일을 업로드",
    note: "저장한 .txt 파일을 그대로 올립니다.",
    alt: "대화 내용 메뉴 전체 모습",
  },
];

const FAQ = [
  {
    q: "Google 캘린더가 자동으로 바뀌나요?",
    a: "아니요. Google에는 직접 고른 일정만 보냅니다.",
  },
  { q: "날짜를 못 찾은 후보는요?", a: "‘날짜 미확정’으로 모이고, 캘린더에서 날짜를 넣을 수 있습니다." },
  { q: "놓치면 안 되는 공지가 있어요", a: "중요 단어를 등록하면 해당 일정에 ★가 붙어 모아 볼 수 있습니다." },
];

function StepNumber({ n }: { n: number }) {
  return (
    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-ark-500 font-display text-xs font-bold text-white">{n}</span>
  );
}

function Eyebrow({ children, dark = false }: { children: React.ReactNode; dark?: boolean }) {
  return <span className={`font-display text-[11px] font-medium tracking-[0.2em] ${dark ? "text-ark-300" : "text-ark-700"}`}>{children}</span>;
}

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
          <nav className="hidden flex-wrap gap-5 text-[13.5px] text-ink-600 md:flex" aria-label="안내 목차">
            <a href="#intro" className="hover:text-slate-900">
              서비스 소개
            </a>
            <a href="#export" className="hover:text-slate-900">
              대화 내보내기 방법
            </a>
            <a href="#flow" className="hover:text-slate-900">
              이용 흐름
            </a>
            <a href="#faq" className="hover:text-slate-900">
              자주 묻는 질문
            </a>
          </nav>
          <Link href="/upload" className="rounded bg-slate-900 px-4 py-2 text-[13.5px] font-semibold text-white hover:bg-slate-700">
            업로드 시작하기
          </Link>
        </div>
      </header>

      <main>
        <section
          id="intro"
          className="relative scroll-mt-16 overflow-hidden bg-gradient-to-r from-navy-950 via-navy-700 to-ark-500 px-4 pt-12 sm:px-10"
        >
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
              <a href="#flow" className="mt-1.5 flex items-center gap-3 self-start text-[13.5px] text-mist-100 hover:text-white">
                이용 방법 보기
                <span className="flex h-[26px] w-[26px] items-center justify-center rounded-full border border-white/50" aria-hidden>
                  <span className="block h-[7px] w-[7px] -translate-y-px rotate-45 border-b-[1.5px] border-r-[1.5px] border-white" />
                </span>
              </a>
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

        <section id="flow" className="mx-auto flex max-w-[1280px] scroll-mt-16 flex-col gap-5 px-4 pb-10 pt-11 sm:px-10">
          <div className="flex flex-wrap items-baseline gap-3">
            <Eyebrow>HOW IT WORKS</Eyebrow>
            <h2 className="text-[25px] font-semibold">다섯 단계로 끝납니다</h2>
          </div>
          <ol className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            {STEPS.map((step, index) => (
              <li
                key={step.title}
                className={`flex flex-col gap-2 rounded-lg border border-slate-200 bg-white p-5 ${index === 0 ? "hud-corner" : ""}`}
              >
                <span className="-skew-x-[10deg] self-start bg-slate-900 px-3 py-1 font-display text-xs font-bold text-white">
                  <span className="inline-block skew-x-[10deg]">STEP {index + 1}</span>
                </span>
                <span className="text-base font-semibold">{step.title}</span>
                <span className="text-[13.5px] leading-[1.7] text-ink-600">{step.body}</span>
              </li>
            ))}
          </ol>
        </section>

        <section id="export" className="mx-auto max-w-[1280px] scroll-mt-16 px-4 pb-11 sm:px-10" aria-label="휴대폰에서 대화 내보내기">
          <div className="flex flex-col gap-5 rounded-[10px] bg-navy-950 px-5 py-7 sm:px-8">
            <div className="flex items-end gap-4">
              <div className="flex flex-col gap-1.5">
                <Eyebrow dark>EXPORT GUIDE · 모바일</Eyebrow>
                <h2 className="text-2xl font-semibold text-white">카카오톡에서 대화 내보내기 (휴대폰)</h2>
                <p className="max-w-[620px] text-[13.5px] leading-[1.7] text-mist-100">
                  채팅방 메뉴 → 설정 → 대화 내용 내보내기 → <strong className="font-semibold text-ark-300">텍스트 메시지만 저장</strong>.
                </p>
              </div>
              <div className="flex-1" />
              <Image
                src="/assets/upperbody1.png"
                alt=""
                width={1254}
                height={1254}
                sizes="150px"
                className="-mb-8 hidden w-[150px] select-none sm:block"
              />
            </div>
            <ol className="grid gap-[18px] md:grid-cols-3">
              {MOBILE_STEPS.map((step, index) => (
                <li key={step.image} className="flex flex-col gap-2.5">
                  <span className="flex items-center gap-2.5 text-sm font-medium text-white">
                    <StepNumber n={index + 1} />
                    {step.title}
                  </span>
                  <div className="relative h-[236px] overflow-hidden rounded-md border border-ark-300/35 bg-black">
                    <Image src={step.image} alt={step.alt} fill sizes="(min-width: 768px) 380px, 100vw" className={`object-cover ${step.position}`} />
                  </div>
                  <span className="text-[12.5px] leading-relaxed text-mist-300">{step.note}</span>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section className="mx-auto max-w-[1280px] px-4 pb-11 sm:px-10" aria-label="PC에서 대화 내보내기">
          <div className="flex flex-col gap-5 rounded-[10px] bg-navy-950 px-5 py-7 sm:px-8">
            <div className="flex flex-col gap-1.5">
              <Eyebrow dark>EXPORT GUIDE · PC</Eyebrow>
              <h2 className="text-2xl font-semibold text-white">PC 카카오톡에서 내보내기</h2>
              <p className="text-[13.5px] leading-[1.7] text-mist-100">
                설정 → 대화 내용 → 대화 내보내기(Ctrl+S). 저장한 <span className="font-display text-ark-300">.txt</span> 파일을 올립니다.
              </p>
            </div>
            <ol className="grid gap-[18px] md:grid-cols-3">
              {PC_STEPS.map((step, index) => (
                <li key={step.image} className="flex flex-col gap-2.5">
                  <span className="flex items-center gap-2.5 text-sm font-medium text-white">
                    <StepNumber n={index + 1} />
                    {step.title}
                  </span>
                  <div className="flex h-[200px] items-center justify-center overflow-hidden rounded-md border border-ark-300/35 bg-slate-100">
                    <Image src={step.image} alt={step.alt} width={step.width} height={step.height} className="max-h-full w-auto max-w-full" />
                  </div>
                  <span className="text-[12.5px] leading-relaxed text-mist-300">{step.note}</span>
                </li>
              ))}
            </ol>
            <p className="rounded border border-ark-300/40 bg-ark-300/10 px-4 py-3 text-[12.5px] leading-relaxed text-mist-100">
              올린 파일은 일정 추출에만 쓰고, 설정에서 언제든 지울 수 있습니다.
            </p>
          </div>
        </section>

        <section id="faq" className="mx-auto flex max-w-[1280px] scroll-mt-16 flex-col gap-3.5 px-4 pb-11 sm:px-10">
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

        <section className="relative overflow-hidden bg-gradient-to-r from-navy-700 to-ark-500 px-4 py-10 sm:px-10">
          <div className="absolute inset-0 bg-[linear-gradient(90deg,rgb(255_255_255/0.06)_1px,transparent_1px)] bg-[length:48px_48px]" aria-hidden />
          <div className="relative mx-auto flex max-w-[1200px] flex-wrap items-center gap-6">
            <div className="flex flex-col gap-2">
              <h2 className="text-[26px] font-semibold text-white">놓친 마감일이 있는지 확인해 보세요</h2>
              <p className="text-[14.5px] text-[#eaf5fd]">대화 파일 하나면 됩니다.</p>
            </div>
            <div className="flex-1" />
            <Link
              href="/upload"
              className="rounded bg-slate-900 px-6 py-3.5 text-[15px] font-semibold text-white shadow-[0_3px_0_rgb(0_0_0/0.25)] hover:bg-slate-700"
            >
              대화 파일 업로드
            </Link>
          </div>
        </section>
      </main>

      <footer className="bg-navy-950 px-4 py-5 sm:px-10">
        <div className="mx-auto flex max-w-[1200px] flex-wrap items-center gap-3.5">
          <span className="block h-3 w-3 rotate-45 bg-ark-300" aria-hidden />
          <span className="font-display text-sm font-semibold tracking-[0.1em] text-white">ARK:U</span>
          <span className="text-[12.5px] text-mist-300">개인용 일정 정리 도구</span>
          <div className="flex-1" />
          <nav className="flex flex-wrap gap-3 text-[12.5px] text-mist-300" aria-label="바닥글">
            <a href="#intro" className="hover:text-white">
              서비스 소개
            </a>
            <a href="#export" className="hover:text-white">
              대화 내보내기 방법
            </a>
            <a href="#faq" className="hover:text-white">
              자주 묻는 질문
            </a>
            <Link href="/privacy" className="hover:text-white">
              개인정보처리방침
            </Link>
            <Link href="/terms" className="hover:text-white">
              이용약관
            </Link>
            <Link href="/upload" className="hover:text-white">
              앱으로 →
            </Link>
          </nav>
        </div>
      </footer>
    </div>
  );
}

import Link from "next/link";

export default function NotFound() {
  return (
    <div className="mx-auto max-w-xl space-y-3 rounded-lg border border-slate-200 bg-white p-6 text-sm">
      <h1 className="text-lg font-semibold">페이지를 찾을 수 없습니다</h1>
      <p className="text-slate-600">주소가 잘못되었거나 더 이상 없는 페이지입니다.</p>
      <div className="flex flex-wrap gap-2">
        <Link href="/" className="rounded bg-slate-900 px-3 py-1.5 font-medium text-white">
          업로드
        </Link>
        <Link href="/candidates" className="rounded border border-slate-300 px-3 py-1.5">
          일정 후보
        </Link>
        <Link href="/calendar" className="rounded border border-slate-300 px-3 py-1.5">
          캘린더
        </Link>
      </div>
    </div>
  );
}

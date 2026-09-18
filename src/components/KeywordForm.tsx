"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { addImportantKeyword, previewImportantKeyword, type KeywordFormState } from "@/app/settings/actions";
import type { KeywordPreview } from "@/lib/importance/keywords";

const INITIAL: KeywordFormState = { error: null, added: null };
/** Above this many matching candidates a word is probably too common to mean "important". */
const BROAD_MATCH = 80;

/** Adds an important keyword, showing first how far it reaches (by title only, overrides ignored). */
export function KeywordForm({ minLength, maxLength }: { minLength: number; maxLength: number }) {
  const [state, setState] = useState<KeywordFormState>(INITIAL);
  const [pending, startTransition] = useTransition();
  const [word, setWord] = useState("");
  const [preview, setPreview] = useState<{ word: string; counts: KeywordPreview } | null>(null);
  const request = useRef(0);

  useEffect(() => {
    const trimmed = word.replace(/\s+/g, "");
    if (trimmed.length < minLength) return;
    const mine = ++request.current;
    const timer = setTimeout(async () => {
      const counts = await previewImportantKeyword(word).catch(() => null);
      if (counts && mine === request.current) setPreview({ word, counts });
    }, 300);
    return () => clearTimeout(timer);
  }, [word, minLength]);

  const shown = preview && preview.word === word && word.replace(/\s+/g, "").length >= minLength ? preview.counts : null;
  const excluded = shown ? shown.excludedCandidates + shown.excludedEvents : 0;

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        const formData = new FormData(event.currentTarget);
        startTransition(async () => {
          const result = await addImportantKeyword(INITIAL, formData);
          setState(result);
          if (!result.error) {
            setWord("");
            setPreview(null);
          }
        });
      }}
      className="space-y-2"
    >
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="text-xs text-slate-500">새 중요 단어 (제목에서만 찾습니다 · 공백과 대소문자는 무시)</span>
          <input
            name="keyword"
            value={word}
            onChange={(event) => setWord(event.target.value)}
            maxLength={maxLength + 20}
            placeholder="예: 운영위원회"
            className="w-full rounded border border-slate-300 bg-white px-2 py-1.5"
            autoComplete="off"
          />
        </label>
        <button type="submit" disabled={pending || word.trim() === ""} className="rounded bg-slate-900 px-3 py-1.5 text-white disabled:opacity-40">
          {pending ? "추가 중…" : "추가"}
        </button>
      </div>
      <p className="min-h-5 text-xs text-slate-600" aria-live="polite">
        {shown && (
          <>
            제목 일치: 후보 <strong className="tabular-nums">{shown.candidates.toLocaleString()}</strong>건 · 캘린더{" "}
            <strong className="tabular-nums">{shown.events.toLocaleString()}</strong>건
            {excluded > 0 ? ` (이 중 직접 제외 ${excluded.toLocaleString()}건)` : ""}
            {shown.candidates >= BROAD_MATCH && <span className="ml-1 text-amber-700">— 흔한 단어라 너무 많이 걸릴 수 있습니다.</span>}
          </>
        )}
      </p>
      {state.error && (
        <p className="rounded border border-red-200 bg-red-50 p-2 text-xs text-red-700" role="alert">
          {state.error}
        </p>
      )}
      {state.added && !state.error && <p className="text-xs text-emerald-700">&ldquo;{state.added}&rdquo;를 추가했습니다. 기존 후보와 일정에도 바로 적용됩니다.</p>}
    </form>
  );
}

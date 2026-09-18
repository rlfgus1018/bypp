import { getDb } from "@/lib/db/client";
import { ExportDecodeError } from "@/lib/kakao-export/decoder";
import { ingestKakaoExport, type ExtractionRange } from "@/lib/pipeline/ingest";

export const runtime = "nodejs";

const MAX_BYTES = 50 * 1024 * 1024;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** "from"/"to" form fields: inclusive KST dates; empty = open-ended. Returns null when malformed. */
function readRange(form: FormData): ExtractionRange | null {
  const from = String(form.get("from") ?? "").trim() || null;
  const to = String(form.get("to") ?? "").trim() || null;
  if ((from && !DATE.test(from)) || (to && !DATE.test(to)) || (from && to && from > to)) return null;
  return { from, to };
}

// Thin wrapper: parse → dedup → detect are all cheap and run synchronously here.
export async function POST(request: Request) {
  const form = await request.formData().catch(() => null);
  if (!form) return Response.json({ error: "요청 형식이 올바르지 않습니다." }, { status: 400 });
  const file = form.get("file");
  if (!(file instanceof File)) return Response.json({ error: "파일이 없습니다." }, { status: 400 });
  if (file.size === 0 || file.size > MAX_BYTES) {
    return Response.json({ error: "파일 크기가 올바르지 않습니다 (최대 50MB)." }, { status: 400 });
  }

  const range = readRange(form);
  if (!range) return Response.json({ error: "추출 기간이 올바르지 않습니다 (YYYY-MM-DD, 시작 ≤ 끝)." }, { status: 400 });

  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const summary = await ingestKakaoExport(await getDb(), { bytes, filename: file.name }, range);
    return Response.json(summary);
  } catch (error) {
    if (error instanceof ExportDecodeError) return Response.json({ error: error.message, code: error.code }, { status: 422 });
    console.error("import failed:", error instanceof Error ? error.message : error);
    return Response.json({ error: "파일을 처리하지 못했습니다." }, { status: 500 });
  }
}

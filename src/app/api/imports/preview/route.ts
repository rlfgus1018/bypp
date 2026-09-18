import { getDb } from "@/lib/db/client";
import { ExportDecodeError } from "@/lib/kakao-export/decoder";
import { previewKakaoExport } from "@/lib/pipeline/ingest";

export const runtime = "nodejs";

const MAX_BYTES = 50 * 1024 * 1024;

// Dry run of an upload: per-day counts only. Nothing is stored and nothing leaves the machine.
export async function POST(request: Request) {
  const form = await request.formData().catch(() => null);
  if (!form) return Response.json({ error: "요청 형식이 올바르지 않습니다." }, { status: 400 });
  const file = form.get("file");
  if (!(file instanceof File)) return Response.json({ error: "파일이 없습니다." }, { status: 400 });
  if (file.size === 0 || file.size > MAX_BYTES) {
    return Response.json({ error: "파일 크기가 올바르지 않습니다 (최대 50MB)." }, { status: 400 });
  }

  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    return Response.json(await previewKakaoExport(getDb(), { bytes, filename: file.name }));
  } catch (error) {
    if (error instanceof ExportDecodeError) return Response.json({ error: error.message, code: error.code }, { status: 422 });
    console.error("preview failed:", error instanceof Error ? error.message : error);
    return Response.json({ error: "파일을 처리하지 못했습니다." }, { status: 500 });
  }
}

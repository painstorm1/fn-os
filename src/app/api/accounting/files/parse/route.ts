import { NextResponse } from "next/server";
import { parseExpenseFiles } from "@/lib/accounting-files";

export const runtime = "nodejs";

function clean(value: unknown) {
  return String(value ?? "").trim();
}

export async function POST(request: Request) {
  try {
    const form = await request.formData();
    const files = form.getAll("files").filter((item): item is File => item instanceof File);
    const sourceType = clean(form.get("source_type")) || "기타";
    const fileSourceTypes = JSON.parse(clean(form.get("file_source_types")) || "[]");
    if (!files.length) {
      return NextResponse.json({ ok: false, error: "업로드할 파일이 없습니다." }, { status: 400 });
    }
    const parsed = await parseExpenseFiles(files, sourceType, Array.isArray(fileSourceTypes) ? fileSourceTypes : []);
    return NextResponse.json({ ok: true, ...parsed });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "비용 파일 파싱 실패" }, { status: 500 });
  }
}

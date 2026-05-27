import { NextRequest, NextResponse } from "next/server";
import { parseExpenseFiles } from "@/lib/accounting-files";
import { importExpenseRows } from "@/lib/accounting";
import { FnosDbError } from "@/lib/fnos-db";

export const runtime = "nodejs";

function clean(value: unknown) {
  return String(value ?? "").trim();
}

export async function POST(request: NextRequest) {
  try {
    const contentType = request.headers.get("content-type") || "";
    if (contentType.includes("multipart/form-data")) {
      const form = await request.formData();
      const files = form.getAll("files").filter((item): item is File => item instanceof File);
      const sourceType = clean(form.get("source_type")) || "기타";
      if (!files.length) {
        return NextResponse.json({ ok: false, error: "업로드할 파일이 없습니다." }, { status: 400 });
      }
      const parsed = await parseExpenseFiles(files, sourceType);
      if (!parsed.rows.length) {
        return NextResponse.json({ ok: false, error: "파일에서 비용 행을 찾지 못했습니다." }, { status: 400 });
      }
      const result = await importExpenseRows(parsed.rows, sourceType, parsed.files.map((file) => file.name).join(", "), clean(form.get("memo")));
      return NextResponse.json({ ...result, files: parsed.files });
    }

    const body = await request.json();
    const rows = Array.isArray(body) ? body : body.rows || [];
    if (!Array.isArray(rows) || rows.length === 0) {
      return NextResponse.json({ ok: false, error: "rows 배열이 필요합니다." }, { status: 400 });
    }
    const result = await importExpenseRows(rows, body.source_type || body.sourceType || "기타", body.source_file_name || body.sourceFileName, body.memo);
    return NextResponse.json(result);
  } catch (error) {
    const status = error instanceof FnosDbError ? error.status : 500;
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "비용 업로드 실패" }, { status });
  }
}

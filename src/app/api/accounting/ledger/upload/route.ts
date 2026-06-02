import { NextRequest, NextResponse } from "next/server";
import { parseExpenseFiles } from "@/lib/accounting-files";
import { importAccountingLedgerRows } from "@/lib/accounting-ledger";
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
      const sourceType = clean(form.get("source_type")) || "자동 분류";
      const fileSourceTypes = JSON.parse(clean(form.get("file_source_types")) || "[]");
      if (!files.length) {
        return NextResponse.json({ ok: false, error: "업로드할 파일이 없습니다." }, { status: 400 });
      }
      const parsed = await parseExpenseFiles(files, sourceType, Array.isArray(fileSourceTypes) ? fileSourceTypes : []);
      if (!parsed.rows.length) {
        return NextResponse.json({ ok: false, error: "파일에서 거래 행을 찾지 못했습니다." }, { status: 400 });
      }
      const result = await importAccountingLedgerRows(parsed.rows, {
        sourceType,
        sourceFileName: parsed.files.map((file) => file.name).join(", "),
        memo: clean(form.get("memo")),
      });
      return NextResponse.json({ ...result, files: parsed.files });
    }

    const body = await request.json();
    const rows = Array.isArray(body) ? body : body.rows || [];
    if (!Array.isArray(rows) || !rows.length) {
      return NextResponse.json({ ok: false, error: "rows 배열이 필요합니다." }, { status: 400 });
    }
    const result = await importAccountingLedgerRows(rows, {
      sourceType: body.source_type || body.sourceType || "자동 분류",
      sourceFileName: body.source_file_name || body.sourceFileName,
      uploadedBy: body.uploaded_by || body.uploadedBy,
      memo: body.memo,
    });
    return NextResponse.json(result);
  } catch (error) {
    const status = error instanceof FnosDbError ? error.status : 500;
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "통합 회계 업로드 실패" }, { status });
  }
}


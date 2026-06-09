import { NextResponse } from "next/server";
import { parseExpenseFiles } from "@/lib/accounting-files";
import { accountingFxRates, classifyAccountingTransactions, normalizeAccountingTransaction } from "@/lib/accounting-ledger";

export const runtime = "nodejs";

function clean(value: unknown) {
  return String(value ?? "").trim();
}

export async function POST(request: Request) {
  try {
    const form = await request.formData();
    const files = form.getAll("files").filter((item): item is File => item instanceof File);
    const sourceType = clean(form.get("source_type")) || "자동 분류";
    const fileSourceTypes = JSON.parse(clean(form.get("file_source_types")) || "[]");
    if (!files.length) {
      return NextResponse.json({ ok: false, error: "업로드할 파일이 없습니다." }, { status: 400 });
    }
    const parsed = await parseExpenseFiles(files, sourceType, Array.isArray(fileSourceTypes) ? fileSourceTypes : []);
    const fxRates = await accountingFxRates();
    const normalized = parsed.rows.map((row) => normalizeAccountingTransaction({ ...row, source_type: row.source_type || sourceType }, fxRates));
    const rows = await classifyAccountingTransactions(normalized);
    return NextResponse.json({ ok: true, rows, files: parsed.files });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "통합 회계 파일 파싱 실패" }, { status: 500 });
  }
}

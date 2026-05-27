import { NextRequest, NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { FnosDbError } from "@/lib/fnos-db";
import { importAdRows } from "@/lib/ads-analysis";

function clean(value: unknown) {
  return String(value ?? "").trim();
}

function rowsFromWorkbook(buffer: Buffer) {
  const workbook = XLSX.read(buffer, { type: "buffer", cellDates: false });
  const rows: Record<string, unknown>[] = [];
  for (const sheetName of workbook.SheetNames) {
    const sheetRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(workbook.Sheets[sheetName], {
      defval: "",
      raw: false,
    });
    rows.push(...sheetRows.filter((row) => Object.values(row).some((value) => clean(value))));
  }
  return rows;
}

export async function POST(request: NextRequest) {
  try {
    const contentType = request.headers.get("content-type") || "";
    if (contentType.includes("multipart/form-data")) {
      const form = await request.formData();
      const channel = clean(form.get("channel")) || "기타";
      const files = form.getAll("files").filter((item): item is File => item instanceof File);
      if (!files.length) {
        return NextResponse.json({ ok: false, error: "업로드할 광고 파일이 없습니다." }, { status: 400 });
      }

      const rows: Record<string, unknown>[] = [];
      const fileNames: string[] = [];
      for (const file of files) {
        const buffer = Buffer.from(await file.arrayBuffer());
        const fileRows = rowsFromWorkbook(buffer).map((row) => ({ ...row, __source_file_name: file.name }));
        rows.push(...fileRows);
        fileNames.push(file.name);
      }

      if (!rows.length) {
        return NextResponse.json({ ok: false, error: "광고 파일에서 읽을 데이터가 없습니다." }, { status: 400 });
      }

      const result = await importAdRows(rows, channel, fileNames.join(", "));
      return NextResponse.json({ ...result, files: fileNames, parsed_count: rows.length }, { status: result.ok ? 200 : result.duplicate ? 409 : 400 });
    }

    const body = await request.json();
    const rows = Array.isArray(body) ? body : body.rows || body.reports || [];
    if (!Array.isArray(rows) || rows.length === 0) {
      return NextResponse.json({ ok: false, error: "업로드할 광고 데이터가 없습니다." }, { status: 400 });
    }
    const result = await importAdRows(rows, body.channel || "기타", body.source_file_name || body.sourceFileName);
    return NextResponse.json(result, { status: result.ok ? 200 : result.duplicate ? 409 : 400 });
  } catch (error) {
    const status = error instanceof FnosDbError ? error.status : 500;
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "광고 업로드 처리 실패" },
      { status },
    );
  }
}

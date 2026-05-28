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

const adChannelOrder = ["메타GFA", "네이버쇼핑검색", "네이버Advoost", "네이버GFA", "쿠팡"];

function ymd(raw: string) {
  return `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`;
}

function reportDateFromFileName(fileName: string) {
  const matches = fileName.match(/20\d{6}/g);
  if (!matches?.length) return new Date().toISOString().slice(0, 10);
  if (matches.length >= 2) return ymd(matches[0]);

  // Naver files usually contain the download date/time in the filename.
  // The business report being uploaded is the previous day's ad result.
  const raw = matches[0];
  const date = new Date(Date.UTC(Number(raw.slice(0, 4)), Number(raw.slice(4, 6)) - 1, Number(raw.slice(6, 8))));
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}

function inferAdChannel(fileName: string, index: number, total: number) {
  const name = fileName.toLowerCase();
  if (name.includes("광고그룹")) return "네이버GFA";
  if (name.includes("쇼핑검색")) return "네이버쇼핑검색";
  if (name.includes("pa_total_campaign") || name.includes("coupang") || name.includes("쿠팡")) return "쿠팡";
  if (name.includes("광고-세트") || name.includes("광고 세트") || name.includes("meta") || name.includes("facebook") || name.includes("instagram") || name.includes("메타")) return "메타GFA";
  if (name.includes("캠페인_") || name.startsWith("캠페인") || name.includes("adboost") || name.includes("advoost") || name.includes("애드부스트")) return "네이버Advoost";
  if (name.includes("shopping")) return "네이버쇼핑검색";
  if (name.includes("gfa") || name.includes("성과형")) return "네이버GFA";
  if (name.includes("캠페인")) return "네이버Advoost";
  if (total >= adChannelOrder.length && index < adChannelOrder.length) return adChannelOrder[index];
  return "네이버쇼핑검색";
}

export async function POST(request: NextRequest) {
  try {
    const contentType = request.headers.get("content-type") || "";
    if (contentType.includes("multipart/form-data")) {
      const form = await request.formData();
      const files = form.getAll("files").filter((item): item is File => item instanceof File);
      const fileChannels = form.getAll("file_channels").map(clean);
      const forceReplace = clean(form.get("force")) === "true";
      if (!files.length) {
        return NextResponse.json({ ok: false, error: "업로드할 광고 파일이 없습니다." }, { status: 400 });
      }

      const fileNames: string[] = [];
      const groupedRows = new Map<string, Record<string, unknown>[]>();
      const groupedFiles = new Map<string, string[]>();
      for (const [index, file] of files.entries()) {
        const inferredChannel = inferAdChannel(file.name, index, files.length);
        const channel = inferredChannel || fileChannels[index] || clean(form.get("channel")) || "네이버쇼핑검색";
        const reportDate = reportDateFromFileName(file.name);
        const buffer = Buffer.from(await file.arrayBuffer());
        const fileRows = rowsFromWorkbook(buffer).map((row) => ({
          ...row,
          __source_file_name: file.name,
          __report_date: reportDate,
        }));
        groupedRows.set(channel, [...(groupedRows.get(channel) || []), ...fileRows]);
        groupedFiles.set(channel, [...(groupedFiles.get(channel) || []), file.name]);
        fileNames.push(file.name);
      }

      const parsedCount = Array.from(groupedRows.values()).reduce((sum, rows) => sum + rows.length, 0);
      if (!parsedCount) {
        return NextResponse.json({ ok: false, error: "광고 파일에서 읽을 데이터가 없습니다." }, { status: 400 });
      }

      const results = [];
      for (const [channel, rows] of groupedRows.entries()) {
        results.push(await importAdRows(rows, channel, (groupedFiles.get(channel) || []).join(", "), { forceReplace }));
      }
      const successCount = results.reduce((sum, result) => sum + result.success_count, 0);
      const failCount = results.reduce((sum, result) => sum + result.fail_count, 0);
      const hardFailures = results.filter((result) => !result.ok && !result.duplicate);
      const duplicateCount = results.filter((result) => result.duplicate).length;
      const confirmationNeeded = results.some((result) => result.needs_confirmation);
      const replacedCount = results.reduce((sum, result) => sum + (result.replaced_count || 0), 0);

      return NextResponse.json({
        ok: hardFailures.length === 0 && !confirmationNeeded,
        needs_confirmation: confirmationNeeded,
        message: hardFailures.length
          ? "일부 광고 파일을 저장하지 못했습니다."
          : confirmationNeeded
            ? results.filter((result) => result.needs_confirmation).map((result) => result.message).join("\n")
          : replacedCount
            ? `기존 광고 데이터 ${replacedCount.toLocaleString("ko-KR")}건을 지우고 ${successCount.toLocaleString("ko-KR")}건으로 교체했습니다.`
          : duplicateCount
            ? `이미 업로드된 파일 ${duplicateCount}개를 제외하고 ${successCount.toLocaleString("ko-KR")}건을 생성했습니다.`
            : `광고 파일 ${fileNames.length}개에서 ${successCount.toLocaleString("ko-KR")}건을 생성했습니다.`,
        files: fileNames,
        parsed_count: parsedCount,
        success_count: successCount,
        fail_count: failCount,
        replaced_count: replacedCount,
        results,
      }, { status: hardFailures.length ? 400 : confirmationNeeded ? 409 : 200 });
    }

    const body = await request.json();
    const rows = Array.isArray(body) ? body : body.rows || body.reports || [];
    if (!Array.isArray(rows) || rows.length === 0) {
      return NextResponse.json({ ok: false, error: "업로드할 광고 데이터가 없습니다." }, { status: 400 });
    }
    const result = await importAdRows(rows, body.channel || "기타", body.source_file_name || body.sourceFileName, { forceReplace: body.force === true });
    return NextResponse.json(result, { status: result.ok ? 200 : result.duplicate ? 409 : 400 });
  } catch (error) {
    const status = error instanceof FnosDbError ? error.status : 500;
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "광고 업로드 처리 실패" },
      { status },
    );
  }
}

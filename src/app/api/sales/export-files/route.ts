import { NextRequest, NextResponse } from "next/server";
import { mkdir, writeFile } from "node:fs/promises";
import * as path from "node:path";

export const runtime = "nodejs";

const DEFAULT_EXPORT_DIR = "\\\\FN-AGENT\\FN_Oder_mall";
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-FNOS-Local-Bridge",
};

function jsonResponse(body: Record<string, unknown>, init?: ResponseInit) {
  return NextResponse.json(body, {
    ...init,
    headers: { ...CORS_HEADERS, ...(init?.headers || {}) },
  });
}

function safeFileName(value: string) {
  const base = path.basename(String(value || "fnos-export.xlsx"));
  const cleaned = base.replace(/[<>:"/\\|?*\x00-\x1F]/g, "_").trim() || "fnos-export.xlsx";
  return cleaned.toLowerCase().endsWith(".xlsx") ? cleaned : `${cleaned}.xlsx`;
}

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get("file");
    if (!(file instanceof File)) {
      return jsonResponse({ ok: false, error: "file is required." }, { status: 400 });
    }

    const exportDir = process.env.FNOS_SHIPPING_EXPORT_DIR || DEFAULT_EXPORT_DIR;
    await mkdir(exportDir, { recursive: true });
    const fileName = safeFileName(file.name);
    const targetPath = path.join(/* turbopackIgnore: true */ exportDir, fileName);
    await writeFile(targetPath, Buffer.from(await file.arrayBuffer()));

    return jsonResponse({ ok: true, path: targetPath });
  } catch (error) {
    return jsonResponse({
      ok: false,
      error: error instanceof Error ? error.message : "고정 내보내기 폴더 저장 실패",
    }, { status: 500 });
  }
}

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

import { execFile } from "child_process";
import { promises as fs } from "fs";
import { promisify } from "util";
import { NextRequest, NextResponse } from "next/server";
import * as path from "path";

export const runtime = "nodejs";

type CleanupResult = {
  fileName: string;
  status: "recycled" | "archived" | "missing" | "skipped" | "failed" | "dry_run";
  message?: string;
  archivePath?: string;
};

const execFileAsync = promisify(execFile);

const localBridgeCorsHeaders = {
  "Access-Control-Allow-Origin": "https://fn-os.vercel.app",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-FNOS-Local-Bridge",
};

const MANUAL_ORDER_DIR = process.env.FNOS_MANUAL_ORDER_DIR || "D:\\FN_Oder_mall";
const MANUAL_ORDER_EXTENSIONS = new Set([".xlsx", ".xls", ".xlsm", ".csv"]);

function jsonResponse(body: Record<string, unknown>, init?: ResponseInit) {
  return NextResponse.json(body, {
    ...init,
    headers: {
      ...localBridgeCorsHeaders,
      ...(init?.headers || {}),
    },
  });
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: localBridgeCorsHeaders });
}

function text(value: unknown) {
  return String(value ?? "").trim();
}

function safeManualFileName(value: unknown) {
  const raw = text(value).split(/[\\/]/).pop() || "";
  const fileName = raw.replace(/[\u0000-\u001f\u007f]/g, "").trim();
  if (!fileName || fileName === "." || fileName === "..") return "";
  if (!MANUAL_ORDER_EXTENSIONS.has(path.extname(fileName).toLowerCase())) return "";
  return fileName;
}

function safeManualFilePath(fileName: string) {
  const root = path.resolve(MANUAL_ORDER_DIR);
  const filePath = path.resolve(root, fileName);
  if (filePath !== root && filePath.startsWith(root + path.sep)) return filePath;
  return "";
}

function psSingleQuote(value: string) {
  return `'${value.replace(/'/g, "''")}'`;
}

async function moveToRecycleBin(filePath: string) {
  if (process.platform !== "win32") throw new Error("Windows 휴지통을 사용할 수 없는 실행환경입니다.");
  const script = [
    "$ErrorActionPreference = 'Stop'",
    `$path = ${psSingleQuote(filePath)}`,
    "$item = Get-Item -LiteralPath $path",
    "$shell = New-Object -ComObject Shell.Application",
    "$recycleBin = $shell.NameSpace(10)",
    "if ($null -eq $recycleBin) { throw 'Recycle Bin not available' }",
    "$recycleBin.MoveHere($item.FullName)",
    "Start-Sleep -Milliseconds 1500",
    "if (Test-Path -LiteralPath $path) { throw 'Recycle Bin move did not remove source file' }",
  ].join("; ");
  await execFileAsync("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script], {
    timeout: 20000,
    windowsHide: true,
  });
}

async function moveToFallbackArchive(filePath: string, fileName: string) {
  const stamp = new Date().toISOString().replace(/\D/g, "").slice(0, 14);
  const archiveDir = path.join(MANUAL_ORDER_DIR, ".fnos_trash", stamp);
  await fs.mkdir(archiveDir, { recursive: true });
  const archivePath = path.join(archiveDir, fileName);
  await fs.rename(filePath, archivePath);
  return archivePath;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({})) as Record<string, unknown>;
    const dryRun = body.dry_run === true || body.dryRun === true;
    const inputFiles: unknown[] = Array.isArray(body.files) ? body.files : [];
    const fileNames: string[] = Array.from(new Set(inputFiles.map(safeManualFileName).filter((fileName): fileName is string => Boolean(fileName))));

    if (!fileNames.length) {
      return jsonResponse({ ok: true, moved: [], results: [], message: "정리할 수동 주문파일이 없습니다." });
    }

    const results: CleanupResult[] = [];
    for (const fileName of fileNames) {
      const filePath = safeManualFilePath(fileName);
      if (!filePath) {
        results.push({ fileName, status: "skipped", message: "허용된 수동 주문 폴더 밖의 경로입니다." });
        continue;
      }
      try {
        const stat = await fs.stat(filePath);
        if (!stat.isFile()) {
          results.push({ fileName, status: "skipped", message: "파일이 아닙니다." });
          continue;
        }
        if (dryRun) {
          results.push({ fileName, status: "dry_run" });
          continue;
        }
        try {
          await moveToRecycleBin(filePath);
          results.push({ fileName, status: "recycled", message: "휴지통으로 이동" });
        } catch (recycleError) {
          const archivePath = await moveToFallbackArchive(filePath, fileName);
          results.push({
            fileName,
            status: "archived",
            archivePath,
            message: `휴지통 이동 실패로 .fnos_trash에 보관: ${recycleError instanceof Error ? recycleError.message : "휴지통 이동 실패"}`,
          });
        }
      } catch (error) {
        const code = error && typeof error === "object" && "code" in error ? String((error as { code?: unknown }).code || "") : "";
        if (code === "ENOENT") {
          results.push({ fileName, status: "missing", message: "이미 정리되었거나 파일이 없습니다." });
        } else {
          results.push({ fileName, status: "failed", message: error instanceof Error ? error.message : "파일 정리 실패" });
        }
      }
    }

    const moved = results.filter((item) => item.status === "recycled" || item.status === "archived").map((item) => item.fileName);
    const recycled = results.filter((item) => item.status === "recycled").map((item) => item.fileName);
    const archived = results.filter((item) => item.status === "archived").map((item) => item.fileName);
    const dryRunFiles = results.filter((item) => item.status === "dry_run").map((item) => item.fileName);
    const failed = results.filter((item) => item.status === "failed" || item.status === "skipped");
    return jsonResponse({
      ok: failed.length === 0,
      dir: MANUAL_ORDER_DIR,
      moved,
      recycled,
      archived,
      dry_run: dryRunFiles,
      results,
      message: dryRun
        ? `${dryRunFiles.length}개 수동 주문파일 정리 대상 확인`
        : `${recycled.length}개 수동 주문파일 휴지통 이동, ${archived.length}개 로컬 보관함 이동`,
    }, failed.length ? { status: 207 } : undefined);
  } catch (error) {
    return jsonResponse({ ok: false, error: error instanceof Error ? error.message : "수동 주문파일 정리 실패" }, { status: 500 });
  }
}

import { spawn } from "child_process";
import { existsSync } from "fs";
import path from "path";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const IMPORT_API_URL =
  process.env.IMPORT_API_URL ||
  process.env.IMPORT_ERP_URL ||
  process.env.NEXT_PUBLIC_IMPORT_API_URL ||
  process.env.NEXT_PUBLIC_IMPORT_ERP_URL ||
  "http://localhost:5500";

const IMPORT_ERP_DIR = process.env.IMPORT_ERP_DIR || path.resolve(process.cwd(), "..", "수입ERP");
const IMPORT_ERP_PYTHON = process.env.IMPORT_ERP_PYTHON || "python";
const LOCAL_ORIGIN = process.env.FN_OS_ORIGIN || "http://127.0.0.1:3000";

function importErpEnv() {
  const {
    DATABASE_URL,
    SUPABASE_DATABASE_URL,
    SUPABASE_URL,
    SUPABASE_KEY,
    SUPABASE_ANON_KEY,
    SUPABASE_SERVICE_ROLE_KEY,
    ...childEnv
  } = process.env;
  void DATABASE_URL;
  void SUPABASE_DATABASE_URL;
  void SUPABASE_URL;
  void SUPABASE_KEY;
  void SUPABASE_ANON_KEY;
  void SUPABASE_SERVICE_ROLE_KEY;
  return {
    ...childEnv,
    FN_OS_SUPPRESS_IMPORT_BROWSER: "1",
    FN_OS_ALLOWED_ORIGINS:
      process.env.FN_OS_ALLOWED_ORIGINS ||
      "http://localhost:3000,http://localhost:3001,http://127.0.0.1:3000,http://127.0.0.1:3001",
  };
}

async function pingImportErp(timeoutMs = 1500) {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    const response = await fetch(`${IMPORT_API_URL.replace(/\/$/, "")}/api/fnos/dashboard`, {
      cache: "no-store",
      headers: { Origin: LOCAL_ORIGIN },
      signal: controller.signal,
    });
    clearTimeout(timeout);
    return response.ok;
  } catch {
    return false;
  }
}

async function waitForImportErp(timeoutMs = 10_000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (await pingImportErp(1200)) return true;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return false;
}

export async function POST() {
  if (await pingImportErp()) {
    return NextResponse.json({ ok: true, status: "running", url: IMPORT_API_URL });
  }

  const appPath = path.join(IMPORT_ERP_DIR, "app.py");
  if (!existsSync(appPath)) {
    return NextResponse.json(
      { ok: false, error: `수입ERP app.py를 찾지 못했습니다: ${appPath}` },
      { status: 404 },
    );
  }

  try {
    const child = spawn(IMPORT_ERP_PYTHON, ["app.py"], {
      cwd: IMPORT_ERP_DIR,
      detached: true,
      stdio: "ignore",
      windowsHide: true,
      env: importErpEnv(),
    });
    child.unref();
  } catch (error) {
    const message = error instanceof Error ? error.message : "수입ERP 서버 기동 실패";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }

  const ready = await waitForImportErp();
  if (!ready) {
    return NextResponse.json(
      { ok: false, status: "starting", error: "수입ERP 서버가 아직 준비되지 않았습니다.", url: IMPORT_API_URL },
      { status: 202 },
    );
  }

  return NextResponse.json({ ok: true, status: "started", url: IMPORT_API_URL });
}

export async function GET() {
  const running = await pingImportErp();
  return NextResponse.json({ ok: running, status: running ? "running" : "stopped", url: IMPORT_API_URL });
}

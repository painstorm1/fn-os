import { NextRequest, NextResponse } from "next/server";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import * as path from "node:path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type AnyRecord = Record<string, unknown>;

const DEFAULT_WORKSPACE_PATH = "D:/FN_AUTOMATION/fnos-online-workspace/workspace.json";
const WORKSPACE_FILE_PATH = process.env.FNOS_ONLINE_WORKSPACE_PATH || DEFAULT_WORKSPACE_PATH;

const localBridgeCorsHeaders = {
  "Access-Control-Allow-Origin": "https://fn-os.vercel.app",
  "Access-Control-Allow-Methods": "GET, PUT, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-FNOS-Local-Bridge",
  "Access-Control-Allow-Private-Network": "true",
};

function jsonResponse(body: AnyRecord, init?: ResponseInit) {
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

function isNotFoundError(error: unknown) {
  return Boolean(error && typeof error === "object" && (error as { code?: string }).code === "ENOENT");
}

async function readWorkspaceSnapshot(): Promise<AnyRecord | null> {
  try {
    const raw = await readFile(/* turbopackIgnore: true */ WORKSPACE_FILE_PATH, "utf8");
    if (!raw.trim()) return null;
    return JSON.parse(raw) as AnyRecord;
  } catch (error) {
    if (isNotFoundError(error)) return null;
    throw error;
  }
}

function workspaceNonEmptyCount(snapshot: AnyRecord | null | undefined) {
  const sheets = snapshot && typeof snapshot.sheets === "object" && snapshot.sheets ? snapshot.sheets as Record<string, unknown> : {};
  return Object.values(sheets).reduce<number>((total, rows) => {
    if (!Array.isArray(rows)) return total;
    return total + rows.filter((row) => {
      if (Array.isArray(row)) return row.some((value) => String(value ?? "").trim());
      if (row && typeof row === "object") return Object.values(row).some((value) => String(value ?? "").trim());
      return String(row ?? "").trim();
    }).length;
  }, 0);
}

export async function GET() {
  try {
    const snapshot = await readWorkspaceSnapshot();
    return jsonResponse({ ok: true, snapshot });
  } catch (error) {
    return jsonResponse({ ok: false, error: error instanceof Error ? error.message : "작업공간 조회 실패" }, { status: 500 });
  }
}

async function handleSave(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({})) as { snapshot?: AnyRecord; expectedUpdatedAt?: string };
    const snapshot = body.snapshot;
    if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) {
      return jsonResponse({ ok: false, error: "snapshot이 필요합니다." }, { status: 400 });
    }
    const expectedUpdatedAt = typeof body.expectedUpdatedAt === "string" ? body.expectedUpdatedAt : "";

    const current = await readWorkspaceSnapshot();
    const currentUpdatedAt = current && typeof current.updatedAt === "string" ? current.updatedAt : "";
    const currentDayKey = current && typeof current.dayKey === "string" ? current.dayKey : "";
    const incomingDayKey = typeof snapshot.dayKey === "string" ? snapshot.dayKey : "";
    const sameDay = Boolean(currentDayKey) && currentDayKey === incomingDayKey;

    if (sameDay && workspaceNonEmptyCount(current) > 0 && workspaceNonEmptyCount(snapshot) === 0) {
      return jsonResponse({ ok: false, conflict: true, snapshot: current, error: "빈 작업공간으로 기존 온라인발주 공유 내역을 덮어쓸 수 없습니다." }, { status: 409 });
    }

    if (sameDay && currentUpdatedAt && expectedUpdatedAt !== currentUpdatedAt) {
      return jsonResponse({ ok: false, conflict: true, snapshot: current, error: "서버에 더 최신 작업공간이 저장되어 있습니다." }, { status: 409 });
    }

    const updatedBy = typeof snapshot.updatedBy === "string" && snapshot.updatedBy.trim() ? snapshot.updatedBy.trim().slice(0, 40) : "unknown-client";
    const finalSnapshot: AnyRecord = {
      ...snapshot,
      updatedAt: new Date().toISOString(),
      updatedBy,
    };

    await mkdir(/* turbopackIgnore: true */ path.dirname(WORKSPACE_FILE_PATH), { recursive: true });
    const tempPath = `${WORKSPACE_FILE_PATH}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(/* turbopackIgnore: true */ tempPath, JSON.stringify(finalSnapshot), "utf8");
    await rename(/* turbopackIgnore: true */ tempPath, WORKSPACE_FILE_PATH);

    return jsonResponse({ ok: true, snapshot: finalSnapshot });
  } catch (error) {
    return jsonResponse({ ok: false, error: error instanceof Error ? error.message : "작업공간 저장 실패" }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  return handleSave(request);
}

export async function POST(request: NextRequest) {
  return handleSave(request);
}

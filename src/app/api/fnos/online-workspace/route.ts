import { NextRequest, NextResponse } from "next/server";
import { mkdir, readFile, writeFile } from "node:fs/promises";
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
    await writeFile(/* turbopackIgnore: true */ WORKSPACE_FILE_PATH, JSON.stringify(finalSnapshot), "utf8");

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

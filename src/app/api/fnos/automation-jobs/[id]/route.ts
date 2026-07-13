import { NextRequest, NextResponse } from "next/server";
import { assertAutomationJobAuth, automationApiError } from "@/lib/automation-agent-api";
import {
  getAutomationJob,
  getAutomationRunAsJob,
  listAutomationLogs,
  listAutomationRunLogs,
  updateAutomationJob,
  updateAutomationRun,
} from "@/lib/automation-jobs";
import { FnosDbError } from "@/lib/fnos-db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function GET(request: NextRequest, context: RouteContext) {
  try {
    assertAutomationJobAuth(request);
    const { id } = await context.params;
    try {
      const job = await getAutomationJob(id);
      const logs = await listAutomationLogs(id);
      return NextResponse.json({ ok: true, job, logs });
    } catch (error) {
      if (!(error instanceof FnosDbError) || error.status !== 404) throw error;
    }
    const job = await getAutomationRunAsJob(id);
    const logs = await listAutomationRunLogs(id);
    return NextResponse.json({ ok: true, job, logs });
  } catch (error) {
    return automationApiError(error, "자동화 작업 상세 조회 실패");
  }
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    assertAutomationJobAuth(request);
    const { id } = await context.params;
    const body = await request.json().catch(() => ({}));
    try {
      const job = await updateAutomationJob(id, body);
      const logs = await listAutomationLogs(id);
      return NextResponse.json({ ok: true, job, logs });
    } catch (error) {
      if (!(error instanceof FnosDbError) || error.status !== 404) throw error;
    }
    const job = await updateAutomationRun(id, body);
    const logs = await listAutomationRunLogs(id);
    return NextResponse.json({ ok: true, job, logs });
  } catch (error) {
    return automationApiError(error, "자동화 작업 상태 업데이트 실패");
  }
}

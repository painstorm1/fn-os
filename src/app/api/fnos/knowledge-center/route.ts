import { NextRequest, NextResponse } from "next/server";
import { assertAutomationAgentAuth, assertAutomationJobAuth, automationApiError } from "@/lib/automation-agent-api";
import {
  applyKnowledgeDailyReceipt,
  applyKnowledgeReceipt,
  createKnowledgeDailyEntry,
  createProductCardRequest,
  decideKnowledgeItems,
  decideKnowledgeItem,
  listKnowledgeCenter,
  retryKnowledgeItem,
  updateKnowledgeTitle,
} from "@/lib/knowledge-center";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    assertAutomationJobAuth(request);
    const params = request.nextUrl.searchParams;
    const data = await listKnowledgeCenter({
      q: params.get("q"),
      status: params.get("status"),
      scope: params.get("scope"),
      processing_status: params.get("processing_status"),
      relationship: params.get("relationship"),
      source_type: params.get("source_type"),
      category: params.get("category"),
      source_date: params.get("source_date"),
      sort: params.get("sort"),
    });
    return NextResponse.json({ ok: true, ...data });
  } catch (error) {
    return automationApiError(error, "지식센터 조회 실패");
  }
}

export async function POST(request: NextRequest) {
  try {
    assertAutomationJobAuth(request);
    const body = await request.json().catch(() => ({}));
    if (body.action === "product_card_request") {
      return NextResponse.json({ ok: true, ...(await createProductCardRequest(body)) });
    }
    if (body.action !== "daily_entry") {
      return NextResponse.json({ ok: false, error: "지원하지 않는 지식센터 입력입니다." }, { status: 400 });
    }
    return NextResponse.json({ ok: true, ...(await createKnowledgeDailyEntry(body)) });
  } catch (error) {
    return automationApiError(error, "오늘 지식 입력 실패");
  }
}

export async function PATCH(request: NextRequest) {
  try {
    assertAutomationJobAuth(request);
    const body = await request.json().catch(() => ({}));
    if (body.action === "retry") return NextResponse.json({ ok: true, ...(await retryKnowledgeItem(body)) });
    if (body.action === "receipt") {
      assertAutomationAgentAuth(request);
      if (body.daily_id) return NextResponse.json({ ok: true, saved: await applyKnowledgeDailyReceipt(body) });
      return NextResponse.json({ ok: true, saved: await applyKnowledgeReceipt(body) });
    }
    if (body.action === "update_title") return NextResponse.json({ ok: true, saved: await updateKnowledgeTitle(body) });
    if (body.action === "bulk") return NextResponse.json({ ok: true, results: await decideKnowledgeItems(body) });
    return NextResponse.json({ ok: true, ...(await decideKnowledgeItem(body)) });
  } catch (error) {
    return automationApiError(error, "지식 판정 처리 실패");
  }
}

import { NextRequest, NextResponse } from "next/server";
import { FnosDbError, hasDbConfig, selectRows } from "@/lib/fnos-db";
import { deleteChannelCredential, readChannelCredentials, saveChannelCredentials } from "@/lib/sales-channel-credentials";

type AnyRecord = Record<string, unknown>;

function text(value: unknown) {
  return String(value ?? "").trim();
}

async function resolveChannel(request: NextRequest, body?: AnyRecord) {
  const channelId = text(body?.channel_id || request.nextUrl.searchParams.get("channel_id"));
  const channelCode = text(body?.channel_code || request.nextUrl.searchParams.get("channel_code")).toUpperCase();
  if (channelId) return channelId;
  if (!channelCode) return "";
  const rows = await selectRows<AnyRecord>("sales_channels", { channel_code: `eq.${channelCode}`, limit: 1 });
  return text(rows[0]?.id);
}

export async function GET(request: NextRequest) {
  try {
    if (!hasDbConfig()) {
      return NextResponse.json({ ok: false, error: "Supabase environment variables are not configured.", credentials: [] }, { status: 503 });
    }
    const channelId = await resolveChannel(request);
    if (!channelId) return NextResponse.json({ ok: false, error: "쇼핑몰 채널을 찾을 수 없습니다." }, { status: 404 });
    const reveal = request.nextUrl.searchParams.get("reveal") === "true";
    return NextResponse.json({ ok: true, channel_id: channelId, credentials: await readChannelCredentials(channelId, reveal) });
  } catch (error) {
    const status = error instanceof FnosDbError ? error.status : 500;
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "쇼핑몰 credential 조회 실패" }, { status });
  }
}

export async function POST(request: NextRequest) {
  try {
    if (!hasDbConfig()) {
      return NextResponse.json({ ok: false, error: "Supabase environment variables are not configured." }, { status: 503 });
    }
    const body = await request.json().catch(() => ({}));
    const channelId = await resolveChannel(request, body);
    if (!channelId) return NextResponse.json({ ok: false, error: "쇼핑몰 채널을 찾을 수 없습니다." }, { status: 404 });
    const saved = await saveChannelCredentials(channelId, body.credentials || body);
    return NextResponse.json({ ok: true, channel_id: channelId, count: saved.length, credentials: await readChannelCredentials(channelId, false) });
  } catch (error) {
    const status = error instanceof FnosDbError ? error.status : 500;
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "쇼핑몰 credential 저장 실패" }, { status });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    if (!hasDbConfig()) {
      return NextResponse.json({ ok: false, error: "Supabase environment variables are not configured." }, { status: 503 });
    }
    const body = await request.json().catch(() => ({}));
    const channelId = await resolveChannel(request, body);
    const credentialKey = text(body.credential_key || request.nextUrl.searchParams.get("credential_key"));
    if (!channelId || !credentialKey) return NextResponse.json({ ok: false, error: "삭제할 credential을 찾을 수 없습니다." }, { status: 400 });
    const deleted = await deleteChannelCredential(channelId, credentialKey);
    return NextResponse.json({ ok: true, deleted: deleted.length });
  } catch (error) {
    const status = error instanceof FnosDbError ? error.status : 500;
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "쇼핑몰 credential 삭제 실패" }, { status });
  }
}

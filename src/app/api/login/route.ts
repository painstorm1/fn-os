import { NextRequest, NextResponse } from "next/server";
import { hasDbConfig, patchRows, selectRows, upsertRows } from "@/lib/fnos-db";

const COOKIE_NAME = "fnos_session";
const PASSWORD_SETTING_KEY = "auth_password";

function authToken() {
  return process.env.FN_OS_AUTH_TOKEN || process.env.FN_OS_PASSWORD || "fnos-local-dev";
}

function fallbackPassword() {
  return process.env.FN_OS_PASSWORD || "fnos1234";
}

async function authPassword() {
  if (!hasDbConfig()) return fallbackPassword();

  try {
    const rows = await selectRows<{ setting_value?: string }>("fnos_settings", {
      setting_key: `eq.${PASSWORD_SETTING_KEY}`,
      limit: 1,
    });
    return String(rows[0]?.setting_value || fallbackPassword());
  } catch {
    return fallbackPassword();
  }
}

function isAuthed(request: NextRequest) {
  return request.cookies.get(COOKIE_NAME)?.value === authToken();
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const password = String(body.password || "");

  if (password !== (await authPassword())) {
    return NextResponse.json({ ok: false, error: "비밀번호가 맞지 않습니다." }, { status: 401 });
  }

  const response = NextResponse.json({ ok: true });
  response.cookies.set({
    name: COOKIE_NAME,
    value: authToken(),
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 14,
  });
  return response;
}

export async function GET(request: NextRequest) {
  if (!isAuthed(request)) {
    return NextResponse.json({ ok: false, error: "인증이 필요합니다." }, { status: 401 });
  }

  return NextResponse.json({ ok: true, password: await authPassword() });
}

export async function PATCH(request: NextRequest) {
  if (!isAuthed(request)) {
    return NextResponse.json({ ok: false, error: "인증이 필요합니다." }, { status: 401 });
  }
  if (!hasDbConfig()) {
    return NextResponse.json({ ok: false, error: "Supabase 환경변수가 설정되지 않아 비밀번호를 저장할 수 없습니다." }, { status: 503 });
  }

  const body = await request.json().catch(() => ({}));
  const currentPassword = String(body.current_password || "");
  const nextPassword = String(body.new_password || "");

  if (currentPassword !== (await authPassword())) {
    return NextResponse.json({ ok: false, error: "현재 비밀번호가 맞지 않습니다." }, { status: 401 });
  }
  if (nextPassword.length < 4) {
    return NextResponse.json({ ok: false, error: "새 비밀번호는 4자 이상으로 입력해 주세요." }, { status: 400 });
  }

  const now = new Date().toISOString();
  try {
    await upsertRows(
      "fnos_settings",
      {
        setting_key: PASSWORD_SETTING_KEY,
        setting_value: nextPassword,
        memo: "FN OS login password",
        updated_at: now,
      },
      "setting_key"
    );
  } catch {
    await patchRows(
      "fnos_settings",
      { setting_key: `eq.${PASSWORD_SETTING_KEY}` },
      { setting_value: nextPassword, updated_at: now }
    );
  }

  return NextResponse.json({ ok: true });
}

export async function DELETE() {
  const response = NextResponse.json({ ok: true });
  response.cookies.set({
    name: COOKIE_NAME,
    value: "",
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
  });
  return response;
}

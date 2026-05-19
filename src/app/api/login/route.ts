import { NextRequest, NextResponse } from "next/server";

const COOKIE_NAME = "fnos_session";

function authToken() {
  return process.env.FN_OS_AUTH_TOKEN || process.env.FN_OS_PASSWORD || "fnos-local-dev";
}

function authPassword() {
  return process.env.FN_OS_PASSWORD || "fnos1234";
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const password = String(body.password || "");

  if (password !== authPassword()) {
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

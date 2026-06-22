import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { buildNaverAuthorizeUrl, assertNaverOAuthConfig } from "@/lib/naver-oauth";

const STATE_COOKIE_NAME = "fnos_naver_oauth_state";
const STATE_MAX_AGE_SECONDS = 60 * 10;

export async function GET() {
  let config;
  try {
    config = assertNaverOAuthConfig();
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "네이버 OAuth 설정이 올바르지 않습니다." },
      { status: 500 }
    );
  }

  if (!config.clientId) {
    return NextResponse.json(
      { ok: false, error: "NAVER_CLIENT_ID 환경변수가 설정되지 않았습니다." },
      { status: 500 }
    );
  }

  const state = randomUUID();
  const response = NextResponse.redirect(buildNaverAuthorizeUrl({ state }));
  response.cookies.set({
    name: STATE_COOKIE_NAME,
    value: state,
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/api/auth/naver",
    maxAge: STATE_MAX_AGE_SECONDS,
  });
  return response;
}

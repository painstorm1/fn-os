import { NextRequest, NextResponse } from "next/server";
import { buildNaverTokenRequestBody, NAVER_TOKEN_URL } from "@/lib/naver-oauth";

const STATE_COOKIE_NAME = "fnos_naver_oauth_state";

type NaverTokenResponse = {
  access_token?: string;
  refresh_token?: string;
  token_type?: string;
  expires_in?: string | number;
  error?: string;
  error_description?: string;
};

function jsonError(message: string, status: number, details?: Record<string, unknown>) {
  return NextResponse.json({ ok: false, error: message, ...(details || {}) }, { status });
}

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const naverError = searchParams.get("error");
  if (naverError) {
    return jsonError("네이버 인증이 거부되었거나 실패했습니다.", 400, {
      naver_error: naverError,
      naver_error_description: searchParams.get("error_description") || "",
    });
  }

  const code = String(searchParams.get("code") || "").trim();
  const state = String(searchParams.get("state") || "").trim();
  if (!code || !state) {
    return jsonError("네이버 callback code/state 파라미터가 없습니다.", 400);
  }

  const cookieState = request.cookies.get(STATE_COOKIE_NAME)?.value;
  if (!cookieState) {
    return jsonError("네이버 OAuth state 쿠키가 없습니다. /api/auth/naver에서 인증을 시작해 주세요.", 400);
  }
  if (cookieState !== state) {
    return jsonError("네이버 OAuth state 값이 일치하지 않습니다.", 400);
  }

  let tokenResponse: NaverTokenResponse;
  try {
    const body = buildNaverTokenRequestBody({ code, state });
    const response = await fetch(NAVER_TOKEN_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
      cache: "no-store",
    });
    tokenResponse = (await response.json().catch(() => ({}))) as NaverTokenResponse;

    if (!response.ok || tokenResponse.error) {
      return jsonError("네이버 access token 발급에 실패했습니다.", 502, {
        naver_error: tokenResponse.error || response.status,
        naver_error_description: tokenResponse.error_description || response.statusText,
      });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "네이버 access token 발급 중 오류가 발생했습니다.";
    return jsonError(message, 500);
  }

  const response = NextResponse.json({
    ok: true,
    provider: "naver",
    token_type: tokenResponse.token_type || "bearer",
    expires_in: tokenResponse.expires_in || null,
    access_token_received: Boolean(tokenResponse.access_token),
    refresh_token_received: Boolean(tokenResponse.refresh_token),
  });
  response.cookies.set({
    name: STATE_COOKIE_NAME,
    value: "",
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/api/auth/naver",
    maxAge: 0,
  });
  return response;
}

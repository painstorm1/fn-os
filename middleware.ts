import { NextRequest, NextResponse } from "next/server";

const COOKIE_NAME = "fnos_session";

function authToken() {
  return process.env.FN_OS_AUTH_TOKEN || process.env.FN_OS_PASSWORD || "fnos-local-dev";
}

function apiToken() {
  return process.env.FN_OS_API_KEY || authToken();
}

export function middleware(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const isLoginPage = pathname === "/login";
  const isLoginApi = pathname === "/api/login";
  const isApi = pathname.startsWith("/api/");
  const isPublicAsset = pathname.startsWith("/_next/") || pathname === "/favicon.ico" || /\.(svg|png|jpg|jpeg|webp|ico)$/.test(pathname);

  if (isLoginPage || isLoginApi || isPublicAsset) {
    return NextResponse.next();
  }

  const session = request.cookies.get(COOKIE_NAME)?.value;
  if (session === authToken()) {
    return NextResponse.next();
  }

  if (isApi) {
    const bearer = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
    const headerToken = request.headers.get("x-fnos-api-key") || bearer;
    if (headerToken && headerToken === apiToken()) {
      return NextResponse.next();
    }
    return NextResponse.json({ ok: false, error: "인증이 필요합니다." }, { status: 401 });
  }

  const loginUrl = request.nextUrl.clone();
  loginUrl.pathname = "/login";
  loginUrl.searchParams.set("next", `${pathname}${search}`);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: ["/((?!api/login|_next/static|_next/image|favicon.ico).*)"],
};

import { NextRequest, NextResponse } from "next/server";

const COOKIE_NAME = "fnos_session";

function authToken() {
  return process.env.FN_OS_AUTH_TOKEN || process.env.FN_OS_PASSWORD || "fnos-local-dev";
}

export function middleware(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const isLoginPage = pathname === "/login";
  const isLoginApi = pathname === "/api/login";
  const isPublicAsset = pathname.startsWith("/_next/") || pathname === "/favicon.ico" || /\.(svg|png|jpg|jpeg|webp|ico)$/.test(pathname);

  if (isLoginPage || isLoginApi || isPublicAsset) {
    return NextResponse.next();
  }

  const session = request.cookies.get(COOKIE_NAME)?.value;
  if (session === authToken()) {
    return NextResponse.next();
  }

  const loginUrl = request.nextUrl.clone();
  loginUrl.pathname = "/login";
  loginUrl.searchParams.set("next", `${pathname}${search}`);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: ["/((?!api/login|_next/static|_next/image|favicon.ico).*)"],
};

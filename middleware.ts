import { proxy } from "./proxy";

export const middleware = proxy;

export const config = {
  matcher: ["/((?!api/login|_next/static|_next/image|favicon.ico).*)"],
};

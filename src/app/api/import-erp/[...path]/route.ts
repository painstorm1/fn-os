import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const IMPORT_API_URL =
  process.env.IMPORT_API_URL ||
  process.env.IMPORT_ERP_URL ||
  process.env.NEXT_PUBLIC_IMPORT_API_URL ||
  "http://localhost:5500";
const IMPORT_API_BYPASS_SECRET = process.env.IMPORT_API_BYPASS_SECRET || "";
const IMPORT_API_AUTH_TOKEN = process.env.IMPORT_API_AUTH_TOKEN || IMPORT_API_BYPASS_SECRET;
const LOCAL_ORIGIN = process.env.FN_OS_ORIGIN || "http://127.0.0.1:3000";

type RouteContext = {
  params: Promise<{ path?: string[] }>;
};

async function ensureImportErp(origin: string) {
  try {
    await fetch(`${origin}/api/fnos/import-erp/ensure`, {
      method: "POST",
      cache: "no-store",
    });
  } catch {
    // The actual proxy request below will return the useful failure if startup fails.
  }
}

async function proxyImportErp(request: NextRequest, context: RouteContext) {
  await ensureImportErp(request.nextUrl.origin);

  const params = await context.params;
  const path = (params.path || []).map(encodeURIComponent).join("/");
  const url = new URL(request.url);
  const target = `${IMPORT_API_URL.replace(/\/$/, "")}/${path}${url.search}`;
  const headers = new Headers();
  const contentType = request.headers.get("content-type");
  if (contentType) headers.set("content-type", contentType);
  headers.set("origin", LOCAL_ORIGIN);
  if (IMPORT_API_BYPASS_SECRET) headers.set("x-vercel-protection-bypass", IMPORT_API_BYPASS_SECRET);
  if (IMPORT_API_AUTH_TOKEN) headers.set("x-fn-os-api-key", IMPORT_API_AUTH_TOKEN);

  const hasBody = !["GET", "HEAD"].includes(request.method);
  const response = await fetch(target, {
    method: request.method,
    headers,
    body: hasBody ? await request.arrayBuffer() : undefined,
    cache: "no-store",
  });

  const responseHeaders = new Headers();
  const responseType = response.headers.get("content-type");
  if (responseType) responseHeaders.set("content-type", responseType);
  return new NextResponse(await response.arrayBuffer(), {
    status: response.status,
    statusText: response.statusText,
    headers: responseHeaders,
  });
}

export async function GET(request: NextRequest, context: RouteContext) {
  return proxyImportErp(request, context);
}

export async function POST(request: NextRequest, context: RouteContext) {
  return proxyImportErp(request, context);
}

export async function PUT(request: NextRequest, context: RouteContext) {
  return proxyImportErp(request, context);
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  return proxyImportErp(request, context);
}

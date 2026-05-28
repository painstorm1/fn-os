import { NextRequest, NextResponse } from "next/server";
import { handleLocalImportErp } from "@/lib/import-erp-local";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ path?: string[] }>;
};

async function routeLocalImportErp(request: NextRequest, context: RouteContext) {
  const params = await context.params;
  const response = await handleLocalImportErp(request, ["api", "fnos", ...(params.path || [])]);
  return response || NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });
}

export async function GET(request: NextRequest, context: RouteContext) {
  return routeLocalImportErp(request, context);
}

export async function POST(request: NextRequest, context: RouteContext) {
  return routeLocalImportErp(request, context);
}

export async function PUT(request: NextRequest, context: RouteContext) {
  return routeLocalImportErp(request, context);
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  return routeLocalImportErp(request, context);
}

import { NextRequest, NextResponse } from "next/server";
import { FnosDbError } from "@/lib/fnos-db";
import { mergePurchaseEntryGroups } from "@/lib/purchase-voucher-merge";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const groupKeys = Array.isArray(body.group_keys)
      ? body.group_keys.map(String)
      : Array.isArray(body.groupKeys)
        ? body.groupKeys.map(String)
        : body.group_key
          ? [String(body.group_key)]
          : [];
    const result = await mergePurchaseEntryGroups(groupKeys);
    return NextResponse.json({ ...result, message: "전표통합 성공" });
  } catch (error) {
    const status = error instanceof FnosDbError ? error.status : 400;
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "전표통합 실패" },
      { status },
    );
  }
}

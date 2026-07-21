import { NextRequest, NextResponse } from "next/server";
import { selectRows } from "@/lib/fnos-db";
import { calculateLclFee } from "@/lib/lcl-fee";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEFAULT_USD_RATE = 1500;

type FxRateRow = {
  rate?: unknown;
};

async function loadUsdRate() {
  const rows = await selectRows<FxRateRow>("import_erp_fx_rates", {
    select: "rate",
    currency: "eq.USD",
    limit: 1,
  }).catch(() => []);
  const rate = Number(rows[0]?.rate);
  return Number.isFinite(rate) && rate > 0 ? rate : DEFAULT_USD_RATE;
}

export async function GET(request: NextRequest) {
  try {
    const method = request.nextUrl.searchParams.get("method") ?? "LCL(분할)";
    const cbm = Number(request.nextUrl.searchParams.get("cbm") ?? 0);
    return NextResponse.json(calculateLclFee(method, cbm, await loadUsdRate()));
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "LCL 배송요금 계산 실패" },
      { status: 500 },
    );
  }
}

import { NextRequest, NextResponse } from "next/server";
import { FnosDbError } from "@/lib/fnos-db";
import { importPurchaseRows, importSalesRows } from "@/lib/sales-inventory";

type QuickInputBody = {
  mode?: "sales" | "purchase";
  form?: Record<string, unknown>;
};

function text(value: unknown) {
  return String(value || "").trim();
}

function compactDate(value: unknown) {
  const raw = text(value).replace(/\D/g, "");
  return raw || new Date().toISOString().slice(0, 10).replace(/\D/g, "");
}

function normalizeRow(form: Record<string, unknown>) {
  return {
    일자: compactDate(form.io_date),
    거래처코드: form.cust_code,
    출하창고: form.wh_cd || "100",
    입고창고: form.wh_cd || "100",
    품목코드: form.prod_cd,
    수량: form.qty,
    "단가(vat포함)": form.price,
    적요: form.remarks,
  };
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => ({}))) as QuickInputBody;
    const form = body.form || {};
    const row = normalizeRow(form);

    if (!text(row.출하창고) || !text(row.품목코드) || !text(row.수량) || !text(row["단가(vat포함)"])) {
      return NextResponse.json({ ok: false, error: "창고코드, 품목코드, 수량, 단가는 필수입니다." }, { status: 400 });
    }

    if (body.mode === "sales") {
      return NextResponse.json(await importSalesRows([row], "quick-sales"));
    }

    if (body.mode === "purchase") {
      return NextResponse.json(await importPurchaseRows([row], "quick-purchase"));
    }

    return NextResponse.json({ ok: false, error: "입력 유형을 선택해 주세요." }, { status: 400 });
  } catch (error) {
    const status = error instanceof FnosDbError ? error.status : 500;
    const message = error instanceof Error ? error.message : "FN OS 간편 입력 실패";
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}

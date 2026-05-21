import { NextRequest, NextResponse } from "next/server";
import { savePurchases, saveSales, toEcountDate } from "@/lib/ecount-client";

type QuickInputBody = {
  mode?: "sales" | "purchase";
  form?: Record<string, unknown>;
};

function required(value: unknown) {
  return String(value || "").trim();
}

function normalizeRow(form: Record<string, unknown>) {
  return {
    io_date: toEcountDate(form.io_date),
    cust_code: form.cust_code,
    wh_cd: form.wh_cd || "100",
    prod_cd: form.prod_cd,
    qty: form.qty,
    price: form.price,
    remarks: form.remarks,
  };
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => ({}))) as QuickInputBody;
    const form = body.form || {};
    const row = normalizeRow(form);

    if (!row.io_date || !required(row.wh_cd) || !required(row.prod_cd) || !required(row.qty) || !required(row.price)) {
      return NextResponse.json({ ok: false, error: "일자, 창고코드, 품목코드, 수량, 단가는 필수입니다." }, { status: 400 });
    }

    if (body.mode === "sales") {
      const result = await saveSales([row]);
      return NextResponse.json({ ok: true, mode: "sales", result });
    }

    if (body.mode === "purchase") {
      const result = await savePurchases([row]);
      return NextResponse.json({ ok: true, mode: "purchase", result });
    }

    return NextResponse.json({ ok: false, error: "입력 유형을 선택해 주세요." }, { status: 400 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "이카운트 간편 입력 실패";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

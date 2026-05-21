import { NextRequest, NextResponse } from "next/server";
import { registerEcountCustomer, registerEcountProduct } from "@/lib/ecount-client";

type QuickRegisterBody = {
  mode?: "product" | "customer";
  form?: Record<string, unknown>;
};

function required(value: unknown) {
  return String(value || "").trim();
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => ({}))) as QuickRegisterBody;
    const form = body.form || {};

    if (body.mode === "product") {
      if (!required(form.prod_cd) || !required(form.prod_name)) {
        return NextResponse.json({ ok: false, error: "품목코드와 품목명은 필수입니다." }, { status: 400 });
      }
      const result = await registerEcountProduct(form);
      return NextResponse.json({ ok: true, mode: "product", result });
    }

    if (body.mode === "customer") {
      if (!required(form.cust_code) || !required(form.cust_name)) {
        return NextResponse.json({ ok: false, error: "거래처코드와 거래처명은 필수입니다." }, { status: 400 });
      }
      const result = await registerEcountCustomer(form);
      return NextResponse.json({ ok: true, mode: "customer", result });
    }

    return NextResponse.json({ ok: false, error: "등록 유형을 선택해 주세요." }, { status: 400 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "이카운트 간편 등록 실패";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

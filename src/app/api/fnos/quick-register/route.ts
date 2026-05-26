import { NextRequest, NextResponse } from "next/server";
import { FnosDbError, insertRows } from "@/lib/fnos-db";

type QuickRegisterBody = {
  mode?: "product" | "customer";
  form?: Record<string, unknown>;
};

function text(value: unknown) {
  return String(value || "").trim();
}

function num(value: unknown) {
  const parsed = Number(String(value ?? "").replace(/[^\d.-]/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => ({}))) as QuickRegisterBody;
    const form = body.form || {};

    if (body.mode === "product") {
      const productCode = text(form.prod_cd || form.product_code);
      const productName = text(form.prod_name || form.product_name);
      if (!productCode || !productName) {
        return NextResponse.json({ ok: false, error: "품목코드와 품목명은 필수입니다." }, { status: 400 });
      }
      const [saved] = await insertRows<Record<string, unknown>>("products", {
        product_code: productCode,
        prod_cd: productCode,
        sku: productCode,
        product_name: productName,
        prod_name: productName,
        size_des: text(form.size_des),
        standard_price: num(form.out_price),
        cost_price: num(form.in_price),
        status: "active",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });
      return NextResponse.json({ ok: true, mode: "product", result: saved, message: "FN OS 상품정보에 저장했습니다." });
    }

    if (body.mode === "customer") {
      const customerCode = text(form.cust_code || form.customer_code);
      const customerName = text(form.cust_name || form.customer_name);
      if (!customerCode || !customerName) {
        return NextResponse.json({ ok: false, error: "거래처코드와 거래처명은 필수입니다." }, { status: 400 });
      }
      const [saved] = await insertRows<Record<string, unknown>>("customers", {
        customer_code: customerCode,
        cust_code: customerCode,
        customer_name: customerName,
        cust_name: customerName,
        business_no: text(form.business_no),
        contact_name: text(form.contact_name),
        phone: text(form.phone),
        memo: text(form.memo || form.remarks),
        is_active: true,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });
      return NextResponse.json({ ok: true, mode: "customer", result: saved, message: "FN OS 거래처정보에 저장했습니다." });
    }

    return NextResponse.json({ ok: false, error: "등록 유형을 선택해 주세요." }, { status: 400 });
  } catch (error) {
    const status = error instanceof FnosDbError ? error.status : 500;
    const message = error instanceof Error ? error.message : "FN OS 간편 등록 실패";
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}

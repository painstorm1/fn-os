import { NextRequest, NextResponse } from "next/server";
import { deleteRows, FnosDbError, hasDbConfig, patchRows, selectRows, upsertRows } from "@/lib/fnos-db";

type AnyRecord = Record<string, unknown>;

function text(value: unknown) {
  return String(value ?? "").trim();
}

function boolActive(value: unknown) {
  const next = String(value || "").trim().toUpperCase();
  if (!next) return true;
  return !["NO", "N", "FALSE", "0", "미사용", "중단", "DELETED"].includes(next);
}

function boolValue(value: unknown, fallback = false) {
  if (typeof value === "boolean") return value;
  const next = text(value).toLowerCase();
  if (!next) return fallback;
  return ["1", "true", "yes", "y", "on", "반영", "include"].includes(next);
}

function schemaColumnFromError(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  return message.match(/column ['"]?([^'"\s]+)['"]?/i)?.[1] || message.match(/Could not find the ['"]?([^'"\s]+)['"]? column/i)?.[1] || "";
}

async function saveCustomerRows(customer: AnyRecord, values: AnyRecord, createdAt: string) {
  let next = { ...values };
  for (let attempt = 0; attempt < 8; attempt += 1) {
    try {
      return text(customer.id)
        ? await patchRows<AnyRecord>("customers", { id: `eq.${customer.id}` }, next)
        : await upsertRows<AnyRecord>("customers", { ...next, created_at: createdAt }, "customer_code");
    } catch (error) {
      const column = schemaColumnFromError(error);
      if (!column || !(column in next)) throw error;
      const { [column]: _removed, ...rest } = next;
      next = rest;
    }
  }
  throw new FnosDbError("거래처 저장 가능한 컬럼 확인에 실패했습니다.", 500);
}

function customerCode(row: AnyRecord) {
  return text(row.customer_code || row.cust_code);
}

function customerName(row: AnyRecord) {
  return text(row.customer_name || row.cust_name);
}

function formatBusinessNo(value: string) {
  const digits = value.replace(/\D/g, "");
  return digits.length === 10 ? `${digits.slice(0, 3)}-${digits.slice(3, 5)}-${digits.slice(5)}` : value;
}

function businessNo(row: AnyRecord) {
  const explicit = text(row.business_no || row.business_number || row.biz_no || row.registration_no || row.company_registration_no);
  if (explicit) return formatBusinessNo(explicit);
  const codeDigits = customerCode(row).replace(/\D/g, "");
  return codeDigits.length === 10 ? formatBusinessNo(codeDigits) : "";
}

function normalizeCustomerType(value: unknown) {
  const normalized = text(value).toLowerCase();
  if (["shopping", "mall", "shop", "쇼핑몰"].includes(normalized)) return "shopping";
  return "general";
}

function customerTypeLabel(value: unknown) {
  return normalizeCustomerType(value) === "shopping" ? "쇼핑몰" : "일반";
}

function matches(values: unknown[], query: string) {
  if (!query) return true;
  const needle = query.toLowerCase().replace(/\s+/g, "");
  return values.some((value) => text(value).toLowerCase().replace(/\s+/g, "").includes(needle));
}

export async function GET(request: NextRequest) {
  try {
    if (!hasDbConfig()) return NextResponse.json({ ok: true, customers: [], total: 0, page: 1, pageSize: 20 });
    const query = text(request.nextUrl.searchParams.get("q"));
    const relation = text(request.nextUrl.searchParams.get("relation"));
    const page = Math.max(1, Number(request.nextUrl.searchParams.get("page") || 1));
    const pageSize = Math.min(5000, Math.max(1, Number(request.nextUrl.searchParams.get("pageSize") || 20)));
    const rows = await selectRows<AnyRecord>("customers", { order: "customer_name.asc", limit: 5000 });
    const normalized = rows
      .filter((row) => text(row.status).toLowerCase() !== "deleted" && row.is_active !== false)
      .map((row) => ({
        id: text(row.id),
        customer_code: customerCode(row),
        customer_name: customerName(row),
        customer_type: normalizeCustomerType(row.customer_type || row.cust_type),
        customer_type_label: customerTypeLabel(row.customer_type || row.cust_type),
        business_no: businessNo(row),
        ceo_name: text(row.ceo_name),
        contact_name: text(row.contact_name),
        phone: text(row.phone),
        fax: text(row.fax),
        email: text(row.email),
        address: text(row.address),
        payment_terms: text(row.payment_terms),
        balance_reflect: boolValue(row.balance_reflect, normalizeCustomerType(row.customer_type || row.cust_type) === "shopping"),
        memo: text(row.memo || row.remarks),
        is_active: boolActive(row.is_active),
      }))
      .filter((row) => {
        if (relation === "shopping") return row.customer_type === "shopping";
        if (relation === "general") return row.customer_type !== "shopping";
        return true;
      })
      .filter((row) => matches([row.customer_code, row.customer_name, row.business_no, row.phone, row.contact_name], query));
    const offset = (page - 1) * pageSize;
    return NextResponse.json({
      ok: true,
      customers: normalized.slice(offset, offset + pageSize),
      total: normalized.length,
      page,
      pageSize,
    });
  } catch (error) {
    const status = error instanceof FnosDbError ? error.status : 500;
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "거래처 조회 실패" }, { status });
  }
}

export async function POST(request: NextRequest) {
  try {
    if (!hasDbConfig()) return NextResponse.json({ ok: false, error: "Supabase 환경변수가 설정되지 않았습니다." }, { status: 503 });
    const body = await request.json().catch(() => ({}));
    const customer = (body.customer || body) as AnyRecord;
    const code = text(customer.customer_code || customer.cust_code);
    const name = text(customer.customer_name || customer.cust_name);
    const customerType = normalizeCustomerType(customer.customer_type || customer.cust_type);
    if (!customerType || !code || !name) return NextResponse.json({ ok: false, error: "속성, 거래처코드, 거래처명은 필수입니다." }, { status: 400 });
    const now = new Date().toISOString();
    const values = {
      customer_code: code,
      cust_code: code,
      customer_name: name,
      cust_name: name,
      customer_type: customerType,
      business_no: text(customer.business_no || customer.business_number || customer.biz_no || customer.registration_no || customer.company_registration_no),
      ceo_name: text(customer.ceo_name),
      contact_name: text(customer.contact_name),
      phone: text(customer.phone),
      fax: text(customer.fax),
      email: text(customer.email),
      address: text(customer.address),
      payment_terms: text(customer.payment_terms),
      balance_reflect: boolValue(customer.balance_reflect, customerType === "shopping"),
      memo: text(customer.memo || customer.remarks),
      is_active: boolActive(customer.is_active),
      updated_at: now,
    };
    const rows = await saveCustomerRows(customer, values, now);
    return NextResponse.json({ ok: true, customer: rows[0] || null });
  } catch (error) {
    const status = error instanceof FnosDbError ? error.status : 500;
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "거래처 저장 실패" }, { status });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    if (!hasDbConfig()) return NextResponse.json({ ok: false, error: "Supabase 환경변수가 설정되지 않았습니다." }, { status: 503 });
    const body = await request.json().catch(() => ({}));
    const id = text(body.id || request.nextUrl.searchParams.get("id"));
    const code = text(body.customer_code || request.nextUrl.searchParams.get("customer_code"));
    if (!id && !code) return NextResponse.json({ ok: false, error: "삭제할 거래처를 찾을 수 없습니다." }, { status: 400 });
    const filters = id ? { id: `eq.${id}` } : { customer_code: `eq.${code}` };
    const rows = await patchRows<AnyRecord>("customers", filters, { status: "deleted", is_active: false, updated_at: new Date().toISOString() })
      .catch(() => deleteRows<AnyRecord>("customers", filters));
    return NextResponse.json({ ok: true, deleted: rows.length });
  } catch (error) {
    const status = error instanceof FnosDbError ? error.status : 500;
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "거래처 삭제 실패" }, { status });
  }
}

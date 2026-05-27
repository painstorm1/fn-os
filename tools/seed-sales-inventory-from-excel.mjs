import fs from "node:fs";
import path from "node:path";
import XLSX from "xlsx";
import { envValue, loadEnvFiles } from "./env-utils.mjs";

const rootDir = process.cwd();
loadEnvFiles(rootDir);

const supabaseUrl = envValue("SUPABASE_URL");
const serviceRoleKey = envValue("SUPABASE_SERVICE_ROLE_KEY");

if (!supabaseUrl || !serviceRoleKey) {
  console.error(
    "SUPABASE_URL 또는 SUPABASE_SERVICE_ROLE_KEY가 없습니다. .env.local에 새 FN OS Supabase 값을 넣은 뒤 다시 실행해 주세요."
  );
  process.exit(1);
}

const defaultFiles = {
  customers: "C:/Users/pains/Downloads/FN_거래처.xlsx",
  warehouses: "C:/Users/pains/Downloads/FN_창고.xlsx",
  products: "C:/Users/pains/Downloads/FN_품목(제품).xlsx",
};

const headers = {
  Authorization: `Bearer ${serviceRoleKey}`,
  apikey: serviceRoleKey,
  "Content-Type": "application/json",
  Prefer: "resolution=merge-duplicates,return=minimal",
};

function clean(value) {
  if (value == null) return "";
  return String(value).trim();
}

function num(value) {
  if (value == null || value === "") return null;
  const n = Number(String(value).replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

function pick(row, names) {
  for (const name of names) {
    if (row[name] != null && clean(row[name]) !== "") return row[name];
  }
  return "";
}

function readTable(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`엑셀 파일을 찾지 못했습니다: ${filePath}`);
  }

  const workbook = XLSX.readFile(filePath, { cellDates: false });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });
  const headerIndex = rows.findIndex((row) =>
    row.some((cell) =>
      ["품목코드", "거래처코드", "창고코드"].includes(clean(cell))
    )
  );
  if (headerIndex < 0) {
    throw new Error(`헤더 행을 찾지 못했습니다: ${filePath}`);
  }

  const headerRow = rows[headerIndex].map((cell) => clean(cell));
  return rows
    .slice(headerIndex + 1)
    .map((row) => {
      const obj = {};
      headerRow.forEach((key, index) => {
        if (key) obj[key] = row[index];
      });
      return obj;
    })
    .filter((row) => Object.values(row).some((value) => clean(value) !== ""));
}

function mapCustomers(rows) {
  const now = new Date().toISOString();
  return rows
    .map((row) => {
      const code = clean(pick(row, ["거래처코드", "BUSINESS_NO", "사업자번호", "코드", "CUST"]));
      const name = clean(pick(row, ["거래처명", "CUST_NAME", "상호", "고객명"]));
      if (!code && !name) return null;
      return {
        customer_code: code || name,
        customer_name: name || code,
        customer_type: "customer",
        business_no: clean(pick(row, ["사업자번호", "BUSINESS_NO"])),
        contact_name: clean(pick(row, ["대표자명", "대표자", "담당자"])),
        phone: clean(pick(row, ["전화", "모바일", "연락처", "TEL"])),
        memo: clean(pick(row, ["검색창내용", "비고", "메모"])),
        is_active: !["NO", "N", "미사용"].includes(clean(pick(row, ["사용구분", "사용"])).toUpperCase()),
        cust_code: code || name,
        cust_name: name || code,
        ceo_name: clean(pick(row, ["대표자명", "대표자"])),
        tel: clean(pick(row, ["전화", "TEL"])),
        mobile: clean(pick(row, ["모바일", "핸드폰"])),
        search_text: clean(pick(row, ["검색창내용"])),
        transfer_info: clean(pick(row, ["이체정보"])),
        updated_at: now,
        last_synced_at: now,
      };
    })
    .filter(Boolean);
}

function mapWarehouses(rows) {
  const now = new Date().toISOString();
  return rows
    .map((row) => {
      const code = clean(pick(row, ["창고코드", "WH_CD", "코드"]));
      const name = clean(pick(row, ["창고명", "WH_DES", "명칭"]));
      if (!code && !name) return null;
      return {
        warehouse_code: code || name,
        warehouse_name: name || code,
        warehouse_type: clean(pick(row, ["구분", "창고구분"])) || "창고",
        memo: clean(pick(row, ["비고", "메모"])),
        is_active: !["NO", "N", "미사용"].includes(clean(pick(row, ["사용"])).toUpperCase()),
        wh_cd: code || name,
        wh_name: name || code,
        wh_type: clean(pick(row, ["구분", "창고구분"])),
        process_name: clean(pick(row, ["생산공정명"])),
        outsource_cust_name: clean(pick(row, ["외주거래처명"])),
        branch_name: clean(pick(row, ["추가사업장명"])),
        updated_at: now,
        last_synced_at: now,
      };
    })
    .filter(Boolean);
}

function mapProducts(rows) {
  const now = new Date().toISOString();
  return rows
    .map((row) => {
      const code = clean(pick(row, ["품목코드", "PROD_CD", "품목코드(ERP)", "상품코드", "코드"]));
      const name = clean(pick(row, ["품목명", "PROD_DES", "품목명(ERP)", "상품명"]));
      if (!code && !name) return null;
      const inPrice = num(pick(row, ["입고단가", "IN_PRICE"]));
      const outPrice = num(pick(row, ["출고단가", "OUT_PRICE"]));
      return {
        product_code: code || name,
        sku: code || name,
        product_name: name || code,
        product_type: clean(pick(row, ["품목그룹1명", "품목구분", "PROD_TYPE"])) || "상품",
        category: clean(pick(row, ["품목그룹1명"])),
        barcode: clean(pick(row, ["바코드", "BAR_CODE"])),
        standard_price: outPrice ?? 0,
        cost_price: inPrice ?? 0,
        currency: "KRW",
        status: "active",
        is_stock_managed: true,
        prod_cd: code || name,
        prod_name: name || code,
        size_des: clean(pick(row, ["규격", "SIZE_DES"])),
        prod_type: clean(pick(row, ["품목구분", "PROD_TYPE"])),
        in_price: inPrice,
        out_price: outPrice,
        is_active: true,
        updated_at: now,
        last_synced_at: now,
      };
    })
    .filter(Boolean);
}

async function upsert(table, rows, conflictColumn) {
  if (!rows.length) return 0;

  let count = 0;
  for (let i = 0; i < rows.length; i += 500) {
    const chunk = rows.slice(i, i + 500);
    const response = await fetch(
      `${supabaseUrl.replace(/\/$/, "")}/rest/v1/${table}?on_conflict=${conflictColumn}`,
      {
        method: "POST",
        headers,
        body: JSON.stringify(chunk),
      }
    );
    if (!response.ok) {
      const body = await response.text();
      if (response.status === 404 && body.includes("PGRST205")) {
        throw new Error(
          `${table} 테이블을 찾지 못했습니다. 먼저 npm run db:schema 로 schema_sales_inventory.sql을 실행해 주세요.`
        );
      }
      throw new Error(`${table} 업서트 실패 (${response.status}): ${body}`);
    }
    count += chunk.length;
  }
  return count;
}

async function main() {
  const jobs = [
    {
      table: "customers",
      file: process.env.FN_CUSTOMERS_XLSX || defaultFiles.customers,
      mapper: mapCustomers,
      conflict: "customer_code",
    },
    {
      table: "warehouses",
      file: process.env.FN_WAREHOUSES_XLSX || defaultFiles.warehouses,
      mapper: mapWarehouses,
      conflict: "warehouse_code",
    },
    {
      table: "products",
      file: process.env.FN_PRODUCTS_XLSX || defaultFiles.products,
      mapper: mapProducts,
      conflict: "product_code",
    },
  ];

  for (const job of jobs) {
    const rows = job.mapper(readTable(path.resolve(job.file)));
    const count = await upsert(job.table, rows, job.conflict);
    console.log(`${job.table}: ${count}건 반영 완료`);
  }
}

await main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});

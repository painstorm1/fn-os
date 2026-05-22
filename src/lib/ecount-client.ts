type EcountLogin = {
  Data?: {
    SESSION_ID?: string;
    Datas?: {
      SESSION_ID?: string;
      EXPIRE_DATE?: string;
    };
    EXPIRE_DATE?: string;
  };
  Status?: string;
  Error?: unknown;
  [key: string]: unknown;
};

type EcountSession = {
  id: string;
  expiresAt: number;
};

let cachedSession: EcountSession | null = null;

function env(name: string) {
  return process.env[name] || "";
}

function baseUrl() {
  const explicit = env("ECOUNT_BASE_URL");
  if (explicit) return explicit.replace(/\/$/, "");
  const zone = env("ECOUNT_ZONE") || "AD";
  const test = env("ECOUNT_USE_TEST_SERVER") === "1" || env("ECOUNT_USE_TEST_SERVER") === "true";
  return `${test ? "https://sboapi" : "https://oapi"}${zone}.ecount.com`;
}

function loginPayload() {
  return {
    COM_CODE: env("ECOUNT_COM_CODE"),
    USER_ID: env("ECOUNT_USER_ID"),
    API_CERT_KEY: env("ECOUNT_API_CERT_KEY"),
    LAN_TYPE: env("ECOUNT_LAN_TYPE") || "ko-KR",
    ZONE: env("ECOUNT_ZONE") || "AD",
  };
}

export function hasEcountConfig() {
  return Boolean(env("ECOUNT_COM_CODE") && env("ECOUNT_USER_ID") && env("ECOUNT_API_CERT_KEY"));
}

async function postJson<T>(path: string, payload: unknown) {
  const response = await fetch(`${baseUrl()}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    cache: "no-store",
  });
  const text = await response.text();
  let data: T;
  try {
    data = JSON.parse(text) as T;
  } catch {
    throw new Error(`ECOUNT API returned non JSON response: ${response.status}`);
  }
  if (!response.ok) throw new Error(`ECOUNT API error ${response.status}: ${text.slice(0, 500)}`);
  return data;
}

export async function getEcountSession() {
  if (cachedSession && cachedSession.expiresAt > Date.now() + 60_000) return cachedSession.id;
  if (!hasEcountConfig()) throw new Error("ECOUNT environment variables are not configured.");

  const loginPath = env("ECOUNT_LOGIN_PATH") || "/OAPI/V2/OAPILogin";
  const data = await postJson<EcountLogin>(loginPath, loginPayload());
  const sessionId = data?.Data?.SESSION_ID || data?.Data?.Datas?.SESSION_ID || (data as Record<string, string>)?.SESSION_ID;
  if (!sessionId) throw new Error("ECOUNT login succeeded but SESSION_ID was not returned.");

  cachedSession = {
    id: sessionId,
    expiresAt: Date.now() + 1000 * 60 * 50,
  };
  return sessionId;
}

export async function postEcountApi<T>(defaultPath: string, payload: unknown, pathEnvName?: string) {
  const sessionId = await getEcountSession();
  const path = env(pathEnvName || "") || defaultPath;
  const separator = path.includes("?") ? "&" : "?";
  return postJson<T>(`${path}${separator}SESSION_ID=${encodeURIComponent(sessionId)}`, payload);
}

export async function postEcountApiWithFallback<T>(defaultPaths: string[], payload: unknown, pathEnvName?: string) {
  const configuredPath = env(pathEnvName || "");
  const paths = configuredPath ? [configuredPath] : defaultPaths;
  let lastError: unknown;
  for (const path of paths) {
    try {
      return await postEcountApi<T>(path, payload);
    } catch (error) {
      lastError = error;
      const message = error instanceof Error ? error.message : String(error);
      if (!/404|No HTTP resource|EXP00001/i.test(message)) break;
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError || "ECOUNT API request failed."));
}

export function toEcountDate(value: unknown) {
  return String(value || "").replace(/\D/g, "").slice(0, 8);
}

export function salePayload(rows: Array<Record<string, unknown>>) {
  return {
    SaleList: rows.map((row, index) => ({
      BulkDatas: {
        UPLOAD_SER_NO: String(row.upload_ser_no || row.UPLOAD_SER_NO || index + 1),
        IO_DATE: toEcountDate(row.io_date || row.IO_DATE || row["일자"]),
        CUST: String(row.cust_code || row.CUST || row["거래처코드"] || ""),
        WH_CD: String(row.wh_cd || row.WH_CD || row["출하창고"] || ""),
        PROD_CD: String(row.prod_cd || row.PROD_CD || row["품목코드"] || ""),
        QTY: String(row.qty || row.QTY || row["수량"] || ""),
        PRICE: String(row.price || row.PRICE || row["단가(vat포함)"] || ""),
        REMARKS: String(row.remarks || row.REMARKS || row["적요"] || ""),
      },
    })),
  };
}

export function purchasePayload(rows: Array<Record<string, unknown>>) {
  return {
    PurchasesList: rows.map((row, index) => ({
      BulkDatas: {
        UPLOAD_SER_NO: String(row.upload_ser_no || row.UPLOAD_SER_NO || index + 1),
        IO_DATE: toEcountDate(row.io_date || row.IO_DATE || row["일자"]),
        CUST: String(row.cust_code || row.CUST || row["거래처코드"] || ""),
        WH_CD: String(row.wh_cd || row.WH_CD || row["입고창고"] || row["출하창고"] || ""),
        PROD_CD: String(row.prod_cd || row.PROD_CD || row["품목코드"] || ""),
        QTY: String(row.qty || row.QTY || row["수량"] || ""),
        PRICE: String(row.price || row.PRICE || row["단가(vat포함)"] || ""),
        REMARKS: String(row.remarks || row.REMARKS || row["적요"] || ""),
      },
    })),
  };
}

export function productRegisterPayload(row: Record<string, unknown>) {
  return {
    InventoryBasicList: [
      {
        BulkDatas: {
          UPLOAD_SER_NO: "1",
          PROD_CD: String(row.prod_cd || row.PROD_CD || row["품목코드"] || ""),
          PROD_DES: String(row.prod_name || row.PROD_DES || row.PROD_NAME || row["품목명"] || ""),
          SIZE_DES: String(row.size_des || row.SIZE_DES || row["규격"] || ""),
          IN_PRICE: String(row.in_price || row.IN_PRICE || row["입고단가"] || ""),
          OUT_PRICE: String(row.out_price || row.OUT_PRICE || row["출고단가"] || ""),
          REMARKS: String(row.remarks || row.REMARKS || row["비고"] || ""),
        },
      },
    ],
  };
}

export function customerRegisterPayload(row: Record<string, unknown>) {
  return {
    CustList: [
      {
        BulkDatas: {
          UPLOAD_SER_NO: "1",
          CUST: String(row.cust_code || row.CUST || row["거래처코드"] || ""),
          CUST_DES: String(row.cust_name || row.CUST_DES || row.CUST_NAME || row["거래처명"] || ""),
          BIZ_NO: String(row.biz_no || row.BIZ_NO || row["사업자번호"] || ""),
          CEO_NAME: String(row.ceo_name || row.CEO_NAME || row["대표자"] || ""),
          TEL: String(row.tel || row.TEL || row["연락처"] || ""),
          REMARKS: String(row.remarks || row.REMARKS || row["비고"] || ""),
        },
      },
    ],
  };
}

export async function saveSales(rows: Array<Record<string, unknown>>) {
  return postEcountApi<Record<string, unknown>>("/OAPI/V2/Sale/SaveSale", salePayload(rows), "ECOUNT_SAVE_SALE_PATH");
}

export async function savePurchases(rows: Array<Record<string, unknown>>) {
  return postEcountApi<Record<string, unknown>>("/OAPI/V2/Purchases/SavePurchases", purchasePayload(rows), "ECOUNT_SAVE_PURCHASES_PATH");
}

export async function registerEcountProduct(row: Record<string, unknown>) {
  return postEcountApi<Record<string, unknown>>(
    "/OAPI/V2/InventoryBasic/SaveInventoryBasic",
    productRegisterPayload(row),
    "ECOUNT_SAVE_PRODUCT_PATH",
  );
}

export async function registerEcountCustomer(row: Record<string, unknown>) {
  return postEcountApi<Record<string, unknown>>(
    "/OAPI/V2/Cust/SaveCust",
    customerRegisterPayload(row),
    "ECOUNT_SAVE_CUSTOMER_PATH",
  );
}

export async function fetchEcountProducts(payload: Record<string, unknown> = {}) {
  return postEcountApi<Record<string, unknown>>(
    "/OAPI/V2/InventoryBasic/GetBasicProductsList",
    {
      PROD_CD: "",
      PROD_TYPE: "0",
      ...payload,
    },
  );
}

export async function fetchEcountInventory(payload: Record<string, unknown> = {}) {
  return postEcountApi<Record<string, unknown>>("/OAPI/V2/InventoryBalance/GetListInventoryBalanceStatus", payload, "ECOUNT_INVENTORY_PATH");
}

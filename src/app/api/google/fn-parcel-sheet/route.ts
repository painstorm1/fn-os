import { createSign } from "crypto";
import { NextRequest, NextResponse } from "next/server";

const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_SHEETS_SCOPE = "https://www.googleapis.com/auth/spreadsheets";

export const runtime = "nodejs";

function env(name: string) {
  return process.env[name] || "";
}

function base64Url(value: string | Buffer) {
  return Buffer.from(value).toString("base64").replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function normalizePrivateKey(value: string) {
  return value.replace(/\\n/g, "\n");
}

function quotedSheetName(sheetName: string) {
  return `'${sheetName.replace(/'/g, "''")}'`;
}

function sheetRange(sheetName: string) {
  return `${quotedSheetName(sheetName)}!A1:ZZ`;
}

function normalizeRow(row: unknown[]) {
  return row.map((cell) => String(cell ?? "").trim()).join("\t");
}

function readableGoogleSheetsError(message: string) {
  if (message.includes("not supported for this document") || message.includes("must not be an Office file")) {
    return "FN_택배시트 반영 대상이 구글 스프레드시트가 아니라 엑셀(.xlsx) 파일입니다. 해당 파일을 Google Sheets로 변환한 뒤, 변환된 구글시트 URL의 spreadsheet ID를 GOOGLE_SHEETS_SPREADSHEET_ID에 넣어주세요.";
  }
  if (message.includes("Requested entity was not found")) {
    return "GOOGLE_SHEETS_SPREADSHEET_ID를 찾을 수 없습니다. 구글시트 ID가 맞는지, 서비스 계정 이메일에 해당 시트 편집 권한을 공유했는지 확인해주세요.";
  }
  if (message.includes("The caller does not have permission") || message.includes("PERMISSION_DENIED")) {
    return "구글시트 접근 권한이 없습니다. GOOGLE_SERVICE_ACCOUNT_EMAIL 값을 해당 구글시트에 편집자로 공유해주세요.";
  }
  return message;
}

async function getGoogleAccessToken() {
  const email = env("GOOGLE_SERVICE_ACCOUNT_EMAIL");
  const privateKey = env("GOOGLE_PRIVATE_KEY");
  if (!email || !privateKey) throw new Error("GOOGLE_SERVICE_ACCOUNT_EMAIL 또는 GOOGLE_PRIVATE_KEY가 설정되지 않았습니다.");

  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const claim = {
    iss: email,
    scope: GOOGLE_SHEETS_SCOPE,
    aud: GOOGLE_TOKEN_URL,
    exp: now + 3600,
    iat: now,
  };
  const unsigned = `${base64Url(JSON.stringify(header))}.${base64Url(JSON.stringify(claim))}`;
  const signer = createSign("RSA-SHA256");
  signer.update(unsigned);
  signer.end();
  const signature = signer.sign(normalizePrivateKey(privateKey));
  const assertion = `${unsigned}.${base64Url(signature)}`;

  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
    cache: "no-store",
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.access_token) {
    throw new Error(String(data.error_description || data.error || "Google access token 발급 실패"));
  }
  return String(data.access_token);
}

async function googleSheetsFetch(path: string, init: RequestInit = {}) {
  const token = await getGoogleAccessToken();
  const response = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
    cache: "no-store",
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(readableGoogleSheetsError(String(data.error?.message || data.error || `Google Sheets API error ${response.status}`)));
  }
  return data;
}

async function ensureSheetExists(spreadsheetId: string, sheetName: string) {
  const metadata = await googleSheetsFetch(`${spreadsheetId}?fields=sheets(properties(title))`);
  const titles = Array.isArray(metadata.sheets)
    ? metadata.sheets.map((sheet: { properties?: { title?: string } }) => String(sheet.properties?.title || ""))
    : [];

  if (titles.includes(sheetName)) return;

  await googleSheetsFetch(`${spreadsheetId}:batchUpdate`, {
    method: "POST",
    body: JSON.stringify({
      requests: [
        {
          addSheet: {
            properties: {
              title: sheetName,
            },
          },
        },
      ],
    }),
  });
}

export async function POST(request: NextRequest) {
  try {
    const spreadsheetId = env("GOOGLE_SHEETS_SPREADSHEET_ID");
    if (!spreadsheetId) throw new Error("GOOGLE_SHEETS_SPREADSHEET_ID가 설정되지 않았습니다.");

    const body = (await request.json().catch(() => ({}))) as { sheetName?: string; rows?: unknown[][] };
    const sheetName = String(body.sheetName || "").trim();
    const rows = Array.isArray(body.rows) ? body.rows.map((row) => row.map((cell) => String(cell ?? ""))) : [];
    const filledRows = rows.filter((row) => row.some((cell) => String(cell || "").trim()));
    if (!sheetName) return NextResponse.json({ ok: false, error: "반영할 시트명이 없습니다." }, { status: 400 });
    if (!filledRows.length) return NextResponse.json({ ok: false, error: "반영할 데이터가 없습니다." }, { status: 400 });

    await ensureSheetExists(spreadsheetId, sheetName);

    const range = sheetRange(sheetName);
    const existing = await googleSheetsFetch(`${spreadsheetId}/values/${encodeURIComponent(range)}?majorDimension=ROWS`);
    const existingRows = Array.isArray(existing.values) ? existing.values as unknown[][] : [];
    const existingSet = new Set(existingRows.map(normalizeRow).filter(Boolean));
    const duplicates = filledRows
      .map((row, index) => ({ rowNumber: index + 1, key: normalizeRow(row) }))
      .filter((item) => item.key && existingSet.has(item.key));

    if (duplicates.length) {
      return NextResponse.json({
        ok: false,
        duplicate: true,
        duplicateCount: duplicates.length,
        duplicateRows: duplicates.map((item) => item.rowNumber),
        error: "붙여넣으려는 값이 이미 구글시트에 존재합니다.",
      }, { status: 409 });
    }

    const appendPath = `${spreadsheetId}/values/${encodeURIComponent(range)}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`;
    const appended = await googleSheetsFetch(appendPath, {
      method: "POST",
      body: JSON.stringify({ values: filledRows }),
    });

    return NextResponse.json({
      ok: true,
      sheetName,
      count: filledRows.length,
      updatedRange: appended.updates?.updatedRange || "",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "FN_택배시트 반영 실패";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

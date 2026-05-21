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

function sheetRange(sheetName: string) {
  return `'${sheetName.replace(/'/g, "''")}'`;
}

function normalizeRow(row: unknown[]) {
  return row.map((cell) => String(cell ?? "").trim()).join("\t");
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
    throw new Error(String(data.error?.message || data.error || `Google Sheets API error ${response.status}`));
  }
  return data;
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

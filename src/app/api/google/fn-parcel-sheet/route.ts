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
  return `${quotedSheetName(sheetName)}!A:K`;
}

function normalizeRow(row: unknown[]) {
  return row.slice(0, 11).map((cell) => String(cell ?? "").trim()).join("\t");
}

function firstEmptyRow(values: unknown[][]) {
  let lastFilled = 0;
  values.forEach((row, index) => {
    if (row.some((cell) => String(cell ?? "").trim())) lastFilled = index + 1;
  });
  return Math.max(2, lastFilled + 1);
}

function normalizeAmount(value: unknown): string | number {
  const text = String(value ?? "").trim().replace(/^'/, "").replace(/,/g, "");
  if (!text) return "";
  const number = Number(text);
  return Number.isFinite(number) ? number : String(value ?? "");
}

function cleanParcelRow(row: unknown[]) {
  const cleaned: (string | number)[] = Array.from({ length: 11 }, (_, index) => {
    const value = row[index];
    return typeof value === "number" ? value : String(value ?? "");
  });
  cleaned[10] = normalizeAmount(cleaned[10]);
  return cleaned;
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

function previousMonthSheetName(sheetName: string) {
  const match = /^(\d{2})(\d{2})$/.exec(sheetName);
  if (!match) return "";
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (!month || month < 1 || month > 12) return "";
  const previousYear = month === 1 ? year - 1 : year;
  const previousMonth = month === 1 ? 12 : month - 1;
  return `${String(previousYear).padStart(2, "0")}${String(previousMonth).padStart(2, "0")}`;
}

async function clearSheetBody(spreadsheetId: string, sheetName: string) {
  await googleSheetsFetch(`${spreadsheetId}/values/${encodeURIComponent(`${quotedSheetName(sheetName)}!A2:K`)}:clear`, {
    method: "POST",
    body: JSON.stringify({}),
  });
}

async function resolveSheetName(spreadsheetId: string, requestedSheetName: string) {
  const metadata = await googleSheetsFetch(`${spreadsheetId}?fields=sheets(properties(sheetId,title))`);
  const sheets: { id?: number; title: string }[] = Array.isArray(metadata.sheets)
    ? metadata.sheets.map((sheet: { properties?: { sheetId?: number; title?: string } }) => ({
      id: sheet.properties?.sheetId,
      title: String(sheet.properties?.title || ""),
    }))
    : [];
  const titles = sheets.map((sheet) => sheet.title);

  if (titles.includes(requestedSheetName)) return requestedSheetName;
  const compactName = requestedSheetName.split("-")[0];
  if (compactName && titles.includes(compactName)) return compactName;

  const newSheetName = compactName || requestedSheetName;
  const previousSheetName = previousMonthSheetName(newSheetName);
  const previousSheet = sheets.find((sheet) => sheet.title === previousSheetName && typeof sheet.id === "number");

  if (previousSheet?.id !== undefined) {
    await googleSheetsFetch(`${spreadsheetId}:batchUpdate`, {
      method: "POST",
      body: JSON.stringify({
        requests: [
          {
            duplicateSheet: {
              sourceSheetId: previousSheet.id,
              newSheetName,
            },
          },
        ],
      }),
    });
    await clearSheetBody(spreadsheetId, newSheetName);
    return newSheetName;
  }

  await googleSheetsFetch(`${spreadsheetId}:batchUpdate`, {
    method: "POST",
    body: JSON.stringify({
      requests: [
        {
          addSheet: {
            properties: {
              title: newSheetName,
            },
          },
        },
      ],
    }),
  });
  return newSheetName;
}

export async function POST(request: NextRequest) {
  try {
    const spreadsheetId = env("GOOGLE_SHEETS_SPREADSHEET_ID");
    if (!spreadsheetId) throw new Error("GOOGLE_SHEETS_SPREADSHEET_ID가 설정되지 않았습니다.");

    const body = (await request.json().catch(() => ({}))) as { sheetName?: string; rows?: unknown[][]; allowPartial?: boolean };
    const requestedSheetName = String(body.sheetName || "").trim();
    const rows = Array.isArray(body.rows) ? body.rows.map(cleanParcelRow) : [];
    const filledRows = rows.filter((row) => row.some((cell) => String(cell || "").trim()));
    if (!requestedSheetName) return NextResponse.json({ ok: false, error: "반영할 시트명이 없습니다." }, { status: 400 });
    if (!filledRows.length) return NextResponse.json({ ok: false, error: "반영할 데이터가 없습니다." }, { status: 400 });

    const sheetName = await resolveSheetName(spreadsheetId, requestedSheetName);

    const range = sheetRange(sheetName);
    const existing = await googleSheetsFetch(`${spreadsheetId}/values/${encodeURIComponent(range)}?majorDimension=ROWS`);
    const existingRows = Array.isArray(existing.values) ? existing.values as unknown[][] : [];
    const existingSet = new Set(existingRows.map(normalizeRow).filter(Boolean));
    const rowStates = filledRows.map((row, index) => ({ rowNumber: index + 1, row, key: normalizeRow(row) }));
    const duplicates = rowStates.filter((item) => item.key && existingSet.has(item.key));
    const uniqueRows = rowStates.filter((item) => item.key && !existingSet.has(item.key)).map((item) => item.row);

    if (duplicates.length && (!uniqueRows.length || !body.allowPartial)) {
      return NextResponse.json({
        ok: false,
        duplicate: true,
        partialAvailable: uniqueRows.length > 0,
        duplicateCount: duplicates.length,
        duplicateRows: duplicates.map((item) => item.rowNumber),
        uniqueCount: uniqueRows.length,
        error: uniqueRows.length
          ? "중복 행이 있습니다. 중복되지 않는 행만 반영할 수 있습니다."
          : "반영할 수 있는 새 행이 없습니다. 모든 행이 이미 구글시트에 있습니다.",
      }, { status: 409 });
    }

    const startRow = firstEmptyRow(existingRows);
    const endRow = startRow + uniqueRows.length - 1;
    const updateRange = `${quotedSheetName(sheetName)}!A${startRow}:K${endRow}`;
    const updated = await googleSheetsFetch(`${spreadsheetId}/values/${encodeURIComponent(updateRange)}?valueInputOption=RAW`, {
      method: "PUT",
      body: JSON.stringify({ values: uniqueRows }),
    });

    return NextResponse.json({
      ok: true,
      sheetName,
      requestedSheetName,
      count: uniqueRows.length,
      duplicateCount: duplicates.length,
      duplicateRows: duplicates.map((item) => item.rowNumber),
      updatedRange: updated.updatedRange || "",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "FN_택배시트 반영 실패";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

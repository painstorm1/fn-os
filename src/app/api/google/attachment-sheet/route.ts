import { createSign } from "crypto";
import { NextRequest, NextResponse } from "next/server";

const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_DRIVE_SCOPE = "https://www.googleapis.com/auth/drive";

export const runtime = "nodejs";

type DriveFile = {
  id?: string;
  name?: string;
  webViewLink?: string;
};

function env(name: string) {
  return process.env[name] || "";
}

function base64Url(value: string | Buffer) {
  return Buffer.from(value).toString("base64").replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function normalizePrivateKey(value: string) {
  return value.replace(/\\n/g, "\n");
}

function hasOAuthConfig() {
  return Boolean(env("GOOGLE_CLIENT_ID") && env("GOOGLE_CLIENT_SECRET") && env("GOOGLE_REFRESH_TOKEN"));
}

function cleanFileName(value: string) {
  return (value || "attachment").replace(/[\\/:*?"<>|]/g, "_").trim() || "attachment";
}

function spreadsheetTitle(attachmentId: string | number | undefined, fileName: string) {
  const base = cleanFileName(fileName).replace(/\.(xlsx|xlsm|xls|csv)$/i, "");
  return attachmentId ? `FNOS_${attachmentId}_${base}` : `FNOS_${base}`;
}

function driveQueryText(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

function excelMimeType(fileName: string, fallback?: string) {
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".xls")) return "application/vnd.ms-excel";
  if (lower.endsWith(".xlsm")) return "application/vnd.ms-excel.sheet.macroEnabled.12";
  if (lower.endsWith(".csv")) return "text/csv";
  return fallback || "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
}

function isExcelFile(fileName: string) {
  return /\.(xlsx|xlsm|xls|csv)$/i.test(fileName);
}

function readableGoogleError(message: string) {
  if (message.includes("Requested entity was not found")) {
    return "GOOGLE_DRIVE_FOLDER_ID를 찾을 수 없습니다. 폴더 ID와 공유 권한을 확인해 주세요.";
  }
  if (message.includes("The caller does not have permission") || message.includes("PERMISSION_DENIED")) {
    return "Google Drive 접근 권한이 없습니다. OAuth 계정 또는 서비스 계정에 해당 Drive 폴더 편집 권한을 공유해 주세요.";
  }
  if (message.includes("Google Drive API has not been used") || message.includes("disabled")) {
    return "Google Drive API가 활성화되어 있지 않습니다. Google Cloud에서 Drive API를 켜 주세요.";
  }
  if (message.includes("storage quota has been exceeded")) {
    return "Google Drive 저장공간 한도를 초과했습니다. OAuth 개인 계정 환경변수가 설정되어 있는지 확인하거나 Drive 저장공간을 정리해 주세요.";
  }
  return message;
}

async function getOAuthAccessToken() {
  const clientId = env("GOOGLE_CLIENT_ID");
  const clientSecret = env("GOOGLE_CLIENT_SECRET");
  const refreshToken = env("GOOGLE_REFRESH_TOKEN");
  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error("GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN이 모두 필요합니다.");
  }

  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
    cache: "no-store",
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.access_token) {
    throw new Error(String(data.error_description || data.error || "Google OAuth access token 발급 실패"));
  }
  return String(data.access_token);
}

async function getServiceAccountAccessToken() {
  const email = env("GOOGLE_SERVICE_ACCOUNT_EMAIL");
  const privateKey = env("GOOGLE_PRIVATE_KEY");
  if (!email || !privateKey) {
    throw new Error("GOOGLE_SERVICE_ACCOUNT_EMAIL 또는 GOOGLE_PRIVATE_KEY가 설정되지 않았습니다.");
  }

  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const claim = {
    iss: email,
    scope: GOOGLE_DRIVE_SCOPE,
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
    throw new Error(String(data.error_description || data.error || "Google service account access token 발급 실패"));
  }
  return String(data.access_token);
}

async function getGoogleAccessToken() {
  if (hasOAuthConfig()) return getOAuthAccessToken();
  return getServiceAccountAccessToken();
}

async function googleDriveFetch(path: string, init: RequestInit = {}) {
  const token = await getGoogleAccessToken();
  const response = await fetch(`https://www.googleapis.com/drive/v3/${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(init.headers || {}),
    },
    cache: "no-store",
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(readableGoogleError(String(data.error?.message || data.error || `Google Drive API error ${response.status}`)));
  }
  return data;
}

async function findExistingSheet(title: string, folderId: string) {
  const folderClause = folderId ? ` and '${driveQueryText(folderId)}' in parents` : "";
  const q = `name='${driveQueryText(title)}' and mimeType='application/vnd.google-apps.spreadsheet' and trashed=false${folderClause}`;
  const params = new URLSearchParams({
    q,
    fields: "files(id,name,webViewLink)",
    pageSize: "1",
    supportsAllDrives: "true",
    includeItemsFromAllDrives: "true",
  });
  const data = await googleDriveFetch(`files?${params.toString()}`) as { files?: DriveFile[] };
  return data.files?.[0] || null;
}

async function downloadSourceFile(fileUrl: string) {
  const response = await fetch(fileUrl, { cache: "no-store" });
  if (!response.ok) throw new Error(`첨부파일 원본을 불러오지 못했습니다. HTTP ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}

async function createGoogleSheet({ title, fileName, fileUrl, mimeType, folderId }: { title: string; fileName: string; fileUrl: string; mimeType?: string; folderId: string }) {
  const token = await getGoogleAccessToken();
  const fileBuffer = await downloadSourceFile(fileUrl);
  const boundary = `fnos_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;
  const metadata = {
    name: title,
    mimeType: "application/vnd.google-apps.spreadsheet",
    ...(folderId ? { parents: [folderId] } : {}),
  };
  const head =
    `--${boundary}\r\n` +
    "Content-Type: application/json; charset=UTF-8\r\n\r\n" +
    `${JSON.stringify(metadata)}\r\n` +
    `--${boundary}\r\n` +
    `Content-Type: ${excelMimeType(fileName, mimeType)}\r\n\r\n`;
  const tail = `\r\n--${boundary}--`;
  const body = Buffer.concat([Buffer.from(head), fileBuffer, Buffer.from(tail)]);

  const response = await fetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink&supportsAllDrives=true", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": `multipart/related; boundary=${boundary}`,
      "Content-Length": String(body.length),
    },
    body,
    cache: "no-store",
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(readableGoogleError(String(data.error?.message || data.error || `Google Drive upload error ${response.status}`)));
  }
  return data as DriveFile;
}

export async function POST(request: NextRequest) {
  try {
    const folderId = env("GOOGLE_DRIVE_FOLDER_ID");
    if (!folderId) {
      return NextResponse.json({
        ok: false,
        error: "GOOGLE_DRIVE_FOLDER_ID가 설정되지 않았습니다. Google Drive 폴더를 만들고 OAuth 계정 또는 서비스 계정에 공유한 뒤 Vercel 환경변수에 폴더 ID를 넣어주세요.",
      }, { status: 400 });
    }

    const body = await request.json().catch(() => ({})) as {
      attachmentId?: number | string;
      fileName?: string;
      fileUrl?: string;
      mimeType?: string;
    };
    const fileName = cleanFileName(String(body.fileName || ""));
    const fileUrl = String(body.fileUrl || "").trim();
    if (!fileUrl || !/^https?:\/\//i.test(fileUrl)) {
      return NextResponse.json({ ok: false, error: "첨부파일 URL이 올바르지 않습니다." }, { status: 400 });
    }
    if (!isExcelFile(fileName)) {
      return NextResponse.json({ ok: false, error: "엑셀 파일만 Google Sheets로 열 수 있습니다." }, { status: 400 });
    }

    const title = spreadsheetTitle(body.attachmentId, fileName);
    const existing = await findExistingSheet(title, folderId);
    const sheet = existing || await createGoogleSheet({ title, fileName, fileUrl, mimeType: body.mimeType, folderId });
    if (!sheet.webViewLink) throw new Error("Google Sheets 링크를 만들지 못했습니다.");

    return NextResponse.json({
      ok: true,
      id: sheet.id,
      title: sheet.name,
      url: sheet.webViewLink,
      reused: Boolean(existing),
      authMode: hasOAuthConfig() ? "oauth" : "service_account",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Google Sheets 열기에 실패했습니다.";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

import { NextRequest, NextResponse } from "next/server";
import { FnosDbError, patchRows, selectRows, uploadStorageFile, upsertRows } from "@/lib/fnos-db";

type AccountType = "bank" | "card" | "personnel" | "company" | "location" | "customer";

type AccountAttachment = {
  id: string;
  account_type: AccountType;
  account_id: string;
  file_path: string;
  file_url: string;
  file_name: string;
  note: string | null;
  file_size: number;
  mime_type: string;
  uploaded_at: string;
};

const SETTING_PREFIX = "fn_settings_account_files";

function text(value: FormDataEntryValue | string | null | undefined) {
  return String(value || "").trim();
}

function settingKey(accountType: AccountType, accountId: string) {
  return `${SETTING_PREFIX}:${accountType}:${accountId}`;
}

function readParams(request: NextRequest): { accountType: AccountType; accountId: string } {
  const typeParam = request.nextUrl.searchParams.get("type");
  const accountType: AccountType =
    typeParam === "card" || typeParam === "personnel" || typeParam === "company" || typeParam === "location" || typeParam === "customer"
      ? typeParam
      : "bank";
  const accountId = text(request.nextUrl.searchParams.get("id"));
  return { accountType, accountId };
}

async function readAttachments(accountType: AccountType, accountId: string) {
  const rows = await selectRows<{ setting_value?: string }>("fnos_settings", {
    setting_key: `eq.${settingKey(accountType, accountId)}`,
    limit: 1,
  }).catch(() => []);
  try {
    const parsed = JSON.parse(rows[0]?.setting_value || "[]");
    return Array.isArray(parsed) ? (parsed as AccountAttachment[]) : [];
  } catch {
    return [];
  }
}

async function saveAttachments(accountType: AccountType, accountId: string, attachments: AccountAttachment[]) {
  const now = new Date().toISOString();
  const key = settingKey(accountType, accountId);
  const payload = {
    setting_key: key,
    setting_value: JSON.stringify(attachments),
    memo: "FN settings account files",
    updated_at: now,
  };
  try {
    await upsertRows("fnos_settings", payload, "setting_key");
  } catch {
    await patchRows("fnos_settings", { setting_key: `eq.${key}` }, { setting_value: payload.setting_value, updated_at: now });
  }
}

function errorResponse(error: unknown, fallback: string) {
  const status = error instanceof FnosDbError ? error.status : 500;
  return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : fallback }, { status });
}

export async function GET(request: NextRequest) {
  try {
    const { accountType, accountId } = readParams(request);
    if (!accountId) return NextResponse.json({ ok: false, error: "계정 id가 필요합니다." }, { status: 400 });
    return NextResponse.json({ ok: true, attachments: await readAttachments(accountType, accountId) });
  } catch (error) {
    return errorResponse(error, "첨부파일 조회 실패");
  }
}

export async function POST(request: NextRequest) {
  try {
    const { accountType, accountId } = readParams(request);
    if (!accountId) return NextResponse.json({ ok: false, error: "계정 id가 필요합니다." }, { status: 400 });
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File) || file.size <= 0) return NextResponse.json({ ok: false, error: "파일이 없습니다." }, { status: 400 });
    const uploaded = await uploadStorageFile(file, `fn-settings/${accountType}/${accountId}`);
    const attachment: AccountAttachment = {
      id: crypto.randomUUID(),
      account_type: accountType,
      account_id: accountId,
      file_path: uploaded.url,
      file_url: uploaded.url,
      file_name: file.name,
      note: text(form.get("note")) || null,
      file_size: file.size,
      mime_type: file.type || "application/octet-stream",
      uploaded_at: new Date().toISOString(),
    };
    const attachments = [attachment, ...(await readAttachments(accountType, accountId))];
    await saveAttachments(accountType, accountId, attachments);
    return NextResponse.json({ ok: true, attachment, attachments });
  } catch (error) {
    return errorResponse(error, "첨부파일 업로드 실패");
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { accountType, accountId } = readParams(request);
    const fileId = text(request.nextUrl.searchParams.get("fileId"));
    if (!accountId || !fileId) return NextResponse.json({ ok: false, error: "삭제할 파일 정보가 필요합니다." }, { status: 400 });
    const attachments = (await readAttachments(accountType, accountId)).filter((item) => item.id !== fileId);
    await saveAttachments(accountType, accountId, attachments);
    return NextResponse.json({ ok: true, attachments });
  } catch (error) {
    return errorResponse(error, "첨부파일 삭제 실패");
  }
}

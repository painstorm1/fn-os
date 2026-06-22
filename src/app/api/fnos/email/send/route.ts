import { NextRequest, NextResponse } from "next/server";

import { sendSmtpMail } from "@/lib/smtp-mailer";

export const runtime = "nodejs";

type EmailPayload = {
  to?: unknown;
  subject?: unknown;
  body?: unknown;
};

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function safeError(error: unknown) {
  if (error instanceof Error) return error.message;
  return "메일 발송에 실패했습니다.";
}

export async function POST(request: NextRequest) {
  let payload: EmailPayload;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "요청 형식이 올바르지 않습니다." }, { status: 400 });
  }

  const to = text(payload.to);
  const subject = text(payload.subject);
  const body = text(payload.body);

  if (!to || !subject || !body) {
    return NextResponse.json({ ok: false, error: "수신자, 제목, 본문이 모두 필요합니다." }, { status: 400 });
  }

  try {
    const result = await sendSmtpMail({ to, subject, text: body });
    return NextResponse.json({ ok: true, to: result.to, from: result.from, subject: result.subject });
  } catch (error) {
    return NextResponse.json({ ok: false, error: safeError(error) }, { status: 500 });
  }
}

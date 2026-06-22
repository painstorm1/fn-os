import { NextRequest, NextResponse } from "next/server";

import { sendSmtpMail, type SmtpMailAttachment } from "@/lib/smtp-mailer";

export const runtime = "nodejs";

type EmailPayload = {
  to?: unknown;
  subject?: unknown;
  body?: unknown;
  pdfHtml?: unknown;
  pdfFilename?: unknown;
};

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function safeError(error: unknown) {
  if (error instanceof Error) return error.message;
  return "메일 발송에 실패했습니다.";
}

function safeFilename(value: string) {
  const base = value
    .replace(/[\\/:*?"<>|]+/g, "_")
    .replace(/\s+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 120) || "FNOS_거래명세서";
  return base.toLowerCase().endsWith(".pdf") ? base : `${base}.pdf`;
}

async function renderPdfAttachment(html: string, filename: string): Promise<SmtpMailAttachment> {
  if (!/^<!doctype html>/i.test(html.slice(0, 64))) {
    throw new Error("PDF 생성용 HTML 형식이 올바르지 않습니다.");
  }
  if (Buffer.byteLength(html, "utf8") > 5 * 1024 * 1024) {
    throw new Error("PDF 생성용 HTML이 너무 큽니다. 전표 수를 줄여서 다시 시도해 주세요.");
  }

  const dynamicImport = new Function("specifier", "return import(specifier)") as (specifier: string) => Promise<typeof import("playwright")>;
  const { chromium } = await dynamicImport("playwright");
  const browser = await chromium.launch({ headless: true, args: ["--no-sandbox", "--disable-setuid-sandbox"] });
  try {
    const page = await browser.newPage({ viewport: { width: 1240, height: 1754 }, deviceScaleFactor: 1 });
    await page.emulateMedia({ media: "print" });
    await page.setContent(html, { waitUntil: "networkidle", timeout: 30_000 });
    const pdf = await page.pdf({ format: "A4", printBackground: true, preferCSSPageSize: true });
    return {
      filename: safeFilename(filename),
      content: Buffer.from(pdf),
      contentType: "application/pdf",
    };
  } finally {
    await browser.close();
  }
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
  const pdfHtml = typeof payload.pdfHtml === "string" ? payload.pdfHtml : "";
  const pdfFilename = text(payload.pdfFilename) || subject || "FNOS_거래명세서";

  if (!to || !subject || !body) {
    return NextResponse.json({ ok: false, error: "수신자, 제목, 본문이 모두 필요합니다." }, { status: 400 });
  }

  try {
    const attachments = pdfHtml ? [await renderPdfAttachment(pdfHtml, pdfFilename)] : [];
    const result = await sendSmtpMail({ to, subject, text: body, attachments });
    return NextResponse.json({
      ok: true,
      to: result.to,
      from: result.from,
      subject: result.subject,
      attachments: result.attachments,
    });
  } catch (error) {
    return NextResponse.json({ ok: false, error: safeError(error) }, { status: 500 });
  }
}

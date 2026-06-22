import tls from "node:tls";
import { Buffer } from "node:buffer";

export type SmtpMailInput = {
  to: string;
  subject: string;
  text: string;
  from?: string;
  fromName?: string;
  replyTo?: string;
};

type SmtpConfig = {
  host: string;
  port: number;
  user: string;
  pass: string;
  from: string;
  fromName: string;
  replyTo?: string;
};

function cleanHeader(value: string) {
  return value.replace(/[\r\n]+/g, " ").trim();
}

function encodeHeader(value: string) {
  const cleaned = cleanHeader(value);
  if (/^[\x20-\x7e]*$/.test(cleaned)) return cleaned;
  return `=?UTF-8?B?${Buffer.from(cleaned, "utf8").toString("base64")}?=`;
}

function encodeAddress(email: string, name?: string) {
  const cleanedEmail = cleanHeader(email);
  const cleanedName = cleanHeader(name || "");
  if (!cleanedName) return `<${cleanedEmail}>`;
  return `${encodeHeader(cleanedName)} <${cleanedEmail}>`;
}

function chunkBase64(value: string) {
  return Buffer.from(value, "utf8").toString("base64").replace(/.{1,76}/g, "$&\r\n").trimEnd();
}

function dotStuff(value: string) {
  return value.replace(/\r?\n/g, "\r\n").replace(/^\./gm, "..");
}

function getSmtpConfig(): SmtpConfig {
  const host = process.env.FNOS_SMTP_HOST || process.env.SMTP_HOST || "smtp.mail.nate.com";
  const port = Number(process.env.FNOS_SMTP_PORT || process.env.SMTP_PORT || "465");
  const user = process.env.FNOS_SMTP_USER || process.env.SMTP_USER || "";
  const pass = process.env.FNOS_SMTP_PASS || process.env.SMTP_PASS || "";
  const from = process.env.FNOS_SMTP_FROM || process.env.SMTP_FROM || user;
  const fromName = process.env.FNOS_SMTP_FROM_NAME || process.env.SMTP_FROM_NAME || "에프엔";
  const replyTo = process.env.FNOS_SMTP_REPLY_TO || process.env.SMTP_REPLY_TO || from;

  if (!host || !port || !user || !pass || !from) {
    throw new Error("SMTP 설정이 없습니다. FNOS_SMTP_HOST/PORT/USER/PASS/FROM 환경변수를 확인해 주세요.");
  }

  return { host, port, user, pass, from, fromName, replyTo };
}

function smtpRequest(socket: tls.TLSSocket, data?: string, expected?: number[]) {
  return new Promise<string>((resolve, reject) => {
    let buffer = "";
    const cleanup = () => {
      socket.off("data", onData);
      socket.off("error", onError);
    };
    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };
    const onData = (chunk: Buffer) => {
      buffer += chunk.toString("utf8");
      const lines = buffer.split(/\r?\n/).filter(Boolean);
      const last = lines[lines.length - 1];
      if (!last || !/^\d{3} /.test(last)) return;
      const code = Number(last.slice(0, 3));
      cleanup();
      if (expected && !expected.includes(code)) {
        reject(new Error(`SMTP 응답 오류: ${code}`));
        return;
      }
      resolve(buffer);
    };
    socket.on("data", onData);
    socket.on("error", onError);
    if (data !== undefined) socket.write(`${data}\r\n`);
  });
}

function connectSmtp(config: SmtpConfig) {
  return new Promise<tls.TLSSocket>((resolve, reject) => {
    const socket = tls.connect({
      host: config.host,
      port: config.port,
      servername: config.host,
      rejectUnauthorized: process.env.FNOS_SMTP_REJECT_UNAUTHORIZED === "0" ? false : true,
    });
    socket.setTimeout(30_000);
    socket.once("secureConnect", () => resolve(socket));
    socket.once("timeout", () => {
      socket.destroy();
      reject(new Error("SMTP 서버 연결 시간이 초과되었습니다."));
    });
    socket.once("error", reject);
  });
}

function buildMessage(input: Required<Pick<SmtpMailInput, "to" | "subject" | "text">> & Pick<SmtpMailInput, "from" | "fromName" | "replyTo">) {
  const from = input.from || "";
  const fromName = input.fromName || "에프엔";
  const replyTo = input.replyTo || from;
  const messageId = `<fnos-${Date.now()}-${Math.random().toString(36).slice(2)}@fnos.local>`;

  const headers = [
    `Date: ${new Date().toUTCString()}`,
    `From: ${encodeAddress(from, fromName)}`,
    `To: ${encodeAddress(input.to)}`,
    replyTo ? `Reply-To: ${encodeAddress(replyTo)}` : "",
    `Subject: ${encodeHeader(input.subject)}`,
    `Message-ID: ${messageId}`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=utf-8",
    "Content-Transfer-Encoding: base64",
  ].filter(Boolean);

  return `${headers.join("\r\n")}\r\n\r\n${chunkBase64(input.text)}`;
}

export async function sendSmtpMail(input: SmtpMailInput) {
  const config = getSmtpConfig();
  const to = cleanHeader(input.to);
  const subject = cleanHeader(input.subject);
  const text = input.text.trim();
  const from = input.from || config.from;
  const fromName = input.fromName || config.fromName;
  const replyTo = input.replyTo || config.replyTo;

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) throw new Error("수신자 이메일 주소 형식이 올바르지 않습니다.");
  if (!subject) throw new Error("메일 제목이 비어 있습니다.");
  if (!text) throw new Error("메일 본문이 비어 있습니다.");

  const socket = await connectSmtp(config);
  try {
    await smtpRequest(socket, undefined, [220]);
    await smtpRequest(socket, "EHLO fnos.local", [250]);
    await smtpRequest(socket, "AUTH LOGIN", [334]);
    await smtpRequest(socket, Buffer.from(config.user, "utf8").toString("base64"), [334]);
    await smtpRequest(socket, Buffer.from(config.pass, "utf8").toString("base64"), [235]);
    await smtpRequest(socket, `MAIL FROM:<${from}>`, [250]);
    await smtpRequest(socket, `RCPT TO:<${to}>`, [250, 251]);
    await smtpRequest(socket, "DATA", [354]);
    socket.write(`${dotStuff(buildMessage({ to, subject, text, from, fromName, replyTo }))}\r\n.\r\n`);
    await smtpRequest(socket, undefined, [250]);
    await smtpRequest(socket, "QUIT", [221, 250]);
  } finally {
    socket.end();
  }

  return { ok: true, to, from, subject };
}

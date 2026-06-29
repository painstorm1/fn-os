type AnyRecord = Record<string, unknown>;

function text(value: unknown) {
  if (typeof value === "string") return value.trim();
  if (value === undefined || value === null) return "";
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return "";
}

function record(value: unknown): AnyRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as AnyRecord : {};
}

function maskSecrets(value: string) {
  return value
    .replace(/(Bearer\s+)[A-Za-z0-9._~+/=-]{8,}/gi, "$1***")
    .replace(/(KakaoAK\s+)[A-Za-z0-9._~+/=-]{8,}/gi, "$1***")
    .replace(/(["']?(?:api[_-]?key|access[_-]?key|secret[_-]?key|auth[_-]?code|token|authorization)["']?\s*[:=]\s*["']?)[^"'\s,}]{4,}/gi, "$1***");
}

export function safeBodySnippet(body: string, maxLength = 240) {
  return maskSecrets(body.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()).slice(0, maxLength);
}

export function safeValueText(value: unknown): string {
  const direct = text(value);
  if (direct) return direct;
  if (!value || typeof value !== "object") return "";
  const obj = record(value);
  for (const key of ["message", "reason", "error_message", "errorMessage", "errorDescription", "error_description", "msg", "returnMessage", "resultDesc", "description", "detail", "title", "code", "errorCode", "returnCode", "resultCode", "status"]) {
    const next = safeValueText(obj[key]);
    if (next) return next;
  }
  try {
    return safeBodySnippet(JSON.stringify(value));
  } catch {
    return "";
  }
}

export async function readJsonApiResponse(response: Response, channelName: string, options: { successCodes?: string[]; resultPaths?: string[][] } = {}) {
  const body = await response.text();
  let data: unknown = {};
  const contentType = response.headers.get("content-type") || "";
  try {
    data = body ? JSON.parse(body) : {};
  } catch {
    const snippet = safeBodySnippet(body);
    throw new Error(`${channelName} API 응답이 JSON이 아닙니다. HTTP ${response.status}${contentType ? ` ${contentType}` : ""}${snippet ? ` - ${snippet}` : ""}`);
  }

  const root = record(data);
  const resultTexts: string[] = [];
  for (const path of options.resultPaths || []) {
    let current: unknown = data;
    for (const key of path) current = record(current)[key];
    const next = safeValueText(current);
    if (next) resultTexts.push(next);
  }
  const code = resultTexts[0] || safeValueText(root.resultCode) || safeValueText(root.returnCode) || safeValueText(root.code) || safeValueText(root.status) || safeValueText(record(root.result).resultCode);
  const normalizedCode = code.toUpperCase();
  const successCodes = new Set((options.successCodes || ["0", "00", "0000", "OK", "SUCCESS"]).map((item) => item.toUpperCase()));
  const explicitFailure = normalizedCode && (/FAIL|ERROR|ERR|401|403|INVALID|UNAUTHORIZED/.test(normalizedCode) || (successCodes.size && !successCodes.has(normalizedCode) && /^(\d+|[A-Z_]+)$/.test(normalizedCode)));

  if (!response.ok || explicitFailure) {
    const message = safeValueText(root.message) || safeValueText(root.msg) || safeValueText(root.error) || safeValueText(record(root.result).resultDesc) || safeValueText(root.returnMessage) || safeBodySnippet(body) || `${channelName} API ${response.status}`;
    throw new Error(message || `${channelName} API ${response.status}`);
  }
  return data;
}

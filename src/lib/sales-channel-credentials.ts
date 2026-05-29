import { createCipheriv, createDecipheriv, createHash, randomBytes } from "crypto";
import { deleteRows, selectRows, upsertRows } from "@/lib/fnos-db";

const SECRET_KEYS = new Set(["seller_password", "api_client_secret", "secret_key", "refresh_token"]);
const CREDENTIAL_KEYS = [
  "seller_password",
  "api_client_id",
  "api_client_secret",
  "access_key",
  "secret_key",
  "refresh_token",
];

type CredentialRow = {
  id?: string;
  channel_id: string;
  credential_key: string;
  credential_value_encrypted?: string | null;
  credential_hint?: string | null;
  is_secret?: boolean;
  updated_at?: string;
};

function encryptionSecret() {
  return (
    process.env.FN_OS_CREDENTIAL_SECRET ||
    process.env.FN_OS_AUTH_TOKEN ||
    process.env.FN_OS_PASSWORD ||
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    "fnos-local-credential-secret"
  );
}

function encryptionKey() {
  return createHash("sha256").update(encryptionSecret()).digest();
}

export function encryptCredential(value: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString("base64")}:${tag.toString("base64")}:${encrypted.toString("base64")}`;
}

export function decryptCredential(value: string) {
  const [version, ivRaw, tagRaw, encryptedRaw] = value.split(":");
  if (version !== "v1" || !ivRaw || !tagRaw || !encryptedRaw) return "";
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(ivRaw, "base64"));
  decipher.setAuthTag(Buffer.from(tagRaw, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(encryptedRaw, "base64")), decipher.final()]).toString("utf8");
}

export function credentialHint(value: string) {
  if (!value) return "";
  if (value.length <= 4) return "*".repeat(value.length);
  return `${value.slice(0, 2)}${"*".repeat(Math.min(8, value.length - 4))}${value.slice(-2)}`;
}

export function isSecretCredential(key: string) {
  return SECRET_KEYS.has(key);
}

export function normalizeCredentialInput(input: unknown) {
  const source = (input || {}) as Record<string, unknown>;
  return CREDENTIAL_KEYS.map((key) => [key, String(source[key] ?? "").trim()] as const).filter(([, value]) => value !== "");
}

export async function credentialSummary(channelIds: string[]) {
  const result = new Map<string, Array<{ key: string; hint: string; is_secret: boolean; has_value: boolean }>>();
  if (!channelIds.length) return result;
  const rows = await selectRows<CredentialRow>("sales_channel_credentials", {
    channel_id: `in.(${channelIds.join(",")})`,
    order: "credential_key.asc",
    limit: 5000,
  });
  rows.forEach((row) => {
    const list = result.get(row.channel_id) || [];
    list.push({
      key: row.credential_key,
      hint: row.credential_hint || "",
      is_secret: row.is_secret !== false,
      has_value: Boolean(row.credential_value_encrypted),
    });
    result.set(row.channel_id, list);
  });
  return result;
}

export async function readChannelCredentials(channelId: string, reveal = false) {
  const rows = await selectRows<CredentialRow>("sales_channel_credentials", {
    channel_id: `eq.${channelId}`,
    order: "credential_key.asc",
    limit: 100,
  });
  return rows.map((row) => ({
    key: row.credential_key,
    value: reveal && row.credential_value_encrypted ? decryptCredential(row.credential_value_encrypted) : "",
    hint: row.credential_hint || "",
    is_secret: row.is_secret !== false,
    has_value: Boolean(row.credential_value_encrypted),
    updated_at: row.updated_at || null,
  }));
}

export async function saveChannelCredentials(channelId: string, credentials: unknown) {
  const now = new Date().toISOString();
  const entries = normalizeCredentialInput(credentials);
  if (!entries.length) return [];
  return upsertRows<CredentialRow>(
    "sales_channel_credentials",
    entries.map(([key, value]) => ({
      channel_id: channelId,
      credential_key: key,
      credential_value_encrypted: encryptCredential(value),
      credential_hint: credentialHint(value),
      is_secret: isSecretCredential(key),
      updated_at: now,
    })),
    "channel_id,credential_key"
  );
}

export async function deleteChannelCredential(channelId: string, credentialKey: string) {
  return deleteRows<CredentialRow>("sales_channel_credentials", {
    channel_id: `eq.${channelId}`,
    credential_key: `eq.${credentialKey}`,
  });
}

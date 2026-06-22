export const NAVER_PRODUCTION_CALLBACK_URL = "https://fn-os.vercel.app/api/auth/naver/callback";
export const NAVER_LOCAL_CALLBACK_URL = "http://127.0.0.1:3000/api/auth/naver/callback";
export const NAVER_AUTHORIZE_URL = "https://nid.naver.com/oauth2.0/authorize";
export const NAVER_TOKEN_URL = "https://nid.naver.com/oauth2.0/token";

export type NaverOAuthEnv = Partial<Record<string, string | undefined>>;

export type NaverOAuthConfig = {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  missing: string[];
};

export type BuildNaverAuthorizeUrlOptions = {
  env?: NaverOAuthEnv;
  state: string;
};

function envValue(env: NaverOAuthEnv, key: string) {
  return String(env[key] || "").trim();
}

function requestedLocalCallback(env: NaverOAuthEnv) {
  return envValue(env, "NAVER_USE_LOCAL_CALLBACK") === "1" || envValue(env, "NAVER_CALLBACK_ENV") === "local";
}

function explicitCallbackUrl(env: NaverOAuthEnv) {
  return envValue(env, "NAVER_REDIRECT_URI") || envValue(env, "NAVER_CALLBACK_URL");
}

export function resolveNaverCallbackUrl(env: NaverOAuthEnv = process.env) {
  const explicit = explicitCallbackUrl(env);
  const isProduction = envValue(env, "NODE_ENV") === "production";

  if (explicit) {
    if (isProduction && explicit !== NAVER_PRODUCTION_CALLBACK_URL) {
      throw new Error(`Production Naver redirect_uri must be ${NAVER_PRODUCTION_CALLBACK_URL}.`);
    }
    if (explicit !== NAVER_PRODUCTION_CALLBACK_URL && explicit !== NAVER_LOCAL_CALLBACK_URL) {
      throw new Error(
        `Invalid NAVER_REDIRECT_URI. Use ${NAVER_PRODUCTION_CALLBACK_URL} or ${NAVER_LOCAL_CALLBACK_URL}.`
      );
    }
    return explicit;
  }

  if (isProduction) {
    return NAVER_PRODUCTION_CALLBACK_URL;
  }

  if (requestedLocalCallback(env) || envValue(env, "NODE_ENV") !== "production") {
    return NAVER_LOCAL_CALLBACK_URL;
  }

  return NAVER_PRODUCTION_CALLBACK_URL;
}

export function naverOAuthConfig(env: NaverOAuthEnv = process.env): NaverOAuthConfig {
  const clientId = envValue(env, "NAVER_CLIENT_ID");
  const clientSecret = envValue(env, "NAVER_CLIENT_SECRET");
  const missing = [
    clientId ? "" : "NAVER_CLIENT_ID",
    clientSecret ? "" : "NAVER_CLIENT_SECRET",
  ].filter(Boolean);

  return {
    clientId,
    clientSecret,
    redirectUri: resolveNaverCallbackUrl(env),
    missing,
  };
}

export function assertNaverOAuthConfig(env: NaverOAuthEnv = process.env) {
  const config = naverOAuthConfig(env);
  if (config.missing.length > 0) {
    throw new Error(`Missing Naver OAuth environment variables: ${config.missing.join(", ")}`);
  }
  return config;
}

export function buildNaverAuthorizeUrl(options: BuildNaverAuthorizeUrlOptions) {
  const config = naverOAuthConfig(options.env || process.env);
  const url = new URL(NAVER_AUTHORIZE_URL);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("redirect_uri", config.redirectUri);
  url.searchParams.set("state", options.state);
  return url.toString();
}

export function buildNaverTokenRequestBody(params: { code: string; state: string; env?: NaverOAuthEnv }) {
  const config = assertNaverOAuthConfig(params.env || process.env);
  const body = new URLSearchParams();
  body.set("grant_type", "authorization_code");
  body.set("client_id", config.clientId);
  body.set("client_secret", config.clientSecret);
  body.set("code", params.code);
  body.set("state", params.state);
  return body;
}

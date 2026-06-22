import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function loadTsModule(relativePath) {
  const filename = resolve(projectRoot, relativePath);
  if (!existsSync(filename)) {
    throw new Error(`Module not found: ${relativePath}`);
  }
  const source = readFileSync(filename, "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
      strict: true,
    },
    fileName: filename,
  }).outputText;
  const cjsModule = { exports: {} };
  const localRequire = createRequire(filename);
  new Function("require", "exports", "module", compiled)(localRequire, cjsModule.exports, cjsModule);
  return cjsModule.exports;
}

const naverOAuth = loadTsModule("src/lib/naver-oauth.ts");

test("네이버 OAuth callback URL 상수는 운영 고정 URL과 로컬 개발 URL을 제공한다", () => {
  assert.equal(naverOAuth.NAVER_PRODUCTION_CALLBACK_URL, "https://fn-os.vercel.app/api/auth/naver/callback");
  assert.equal(naverOAuth.NAVER_LOCAL_CALLBACK_URL, "http://127.0.0.1:3000/api/auth/naver/callback");
});

test("운영 환경 redirect_uri는 fn-os.vercel.app callback URL로 고정된다", () => {
  const url = naverOAuth.resolveNaverCallbackUrl({ NODE_ENV: "production", VERCEL: "1" });
  assert.equal(url, "https://fn-os.vercel.app/api/auth/naver/callback");
});

test("운영 환경에서는 로컬 callback 플래그가 있어도 운영 callback URL을 사용한다", () => {
  const url = naverOAuth.resolveNaverCallbackUrl({ NODE_ENV: "production", NAVER_USE_LOCAL_CALLBACK: "1" });
  assert.equal(url, "https://fn-os.vercel.app/api/auth/naver/callback");
});

test("운영 환경에서는 명시적 로컬 redirect_uri를 허용하지 않는다", () => {
  assert.throws(
    () => naverOAuth.resolveNaverCallbackUrl({
      NODE_ENV: "production",
      NAVER_REDIRECT_URI: "http://127.0.0.1:3000/api/auth/naver/callback",
    }),
    /Production Naver redirect_uri must be/
  );
});

test("로컬 개발 환경은 127.0.0.1:3000 callback URL을 지원한다", () => {
  const url = naverOAuth.resolveNaverCallbackUrl({ NODE_ENV: "development" });
  assert.equal(url, "http://127.0.0.1:3000/api/auth/naver/callback");
});

test("네이버 인증 요청 URL은 환경변수 client_id와 정확한 redirect_uri를 사용한다", () => {
  const url = new URL(
    naverOAuth.buildNaverAuthorizeUrl({
      env: { NODE_ENV: "production", NAVER_CLIENT_ID: "client-id-123" },
      state: "state-abc",
    })
  );

  assert.equal(url.origin + url.pathname, "https://nid.naver.com/oauth2.0/authorize");
  assert.equal(url.searchParams.get("response_type"), "code");
  assert.equal(url.searchParams.get("client_id"), "client-id-123");
  assert.equal(url.searchParams.get("redirect_uri"), "https://fn-os.vercel.app/api/auth/naver/callback");
  assert.equal(url.searchParams.get("state"), "state-abc");
});

test("네이버 OAuth 설정은 client_secret을 환경변수에서만 읽는다", () => {
  const config = naverOAuth.naverOAuthConfig({
    NODE_ENV: "production",
    NAVER_CLIENT_ID: "client-id-123",
    NAVER_CLIENT_SECRET: "secret-from-env",
  });

  assert.equal(config.clientId, "client-id-123");
  assert.equal(config.clientSecret, "secret-from-env");
  assert.equal(config.redirectUri, "https://fn-os.vercel.app/api/auth/naver/callback");
});

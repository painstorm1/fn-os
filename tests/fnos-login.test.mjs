import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function loadRouteModule(relativePath) {
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
  const nextResponse = {
    json(body, init = {}) {
      return {
        body,
        status: init.status || 200,
        cookieOptions: null,
        cookies: {
          set(options) {
            this.owner.cookieOptions = options;
          },
          owner: null,
        },
      };
    },
  };
  const localRequire = (specifier) => {
    if (specifier === "next/server") {
      return { NextResponse: nextResponse, NextRequest: class NextRequest {} };
    }
    if (specifier === "@/lib/fnos-db") {
      return {
        hasDbConfig: () => false,
        selectRows: async () => [],
        patchRows: async () => undefined,
        upsertRows: async () => undefined,
      };
    }
    return createRequire(filename)(specifier);
  };
  const originalJson = nextResponse.json;
  nextResponse.json = (body, init = {}) => {
    const response = originalJson(body, init);
    response.cookies.owner = response;
    return response;
  };
  new Function("require", "exports", "module", compiled)(localRequire, cjsModule.exports, cjsModule);
  return cjsModule.exports;
}

test("로그인 화면은 내부 업무/관리자 전용/로그인 필요 안내문을 표시한다", () => {
  const source = readFileSync(resolve(projectRoot, "src/app/login/page.tsx"), "utf8");

  assert.match(source, /내부 업무 자동화 및 광고\/매출 관리 시스템입니다\./);
  assert.match(source, /관리자 전용 서비스입니다\./);
  assert.match(source, /로그인이 필요합니다\./);
});

test("로그인 성공 쿠키는 브라우저 종료 시 사라지는 세션 쿠키로 발급된다", async () => {
  const loginRoute = loadRouteModule("src/app/api/login/route.ts");
  const response = await loginRoute.POST({ json: async () => ({ password: "fnos1234" }) });

  assert.equal(response.status, 200);
  assert.equal(response.cookieOptions.name, "fnos_session");
  assert.equal(response.cookieOptions.httpOnly, true);
  assert.equal(response.cookieOptions.path, "/");
  assert.equal(response.cookieOptions.sameSite, "lax");
  assert.equal(response.cookieOptions.maxAge, undefined);
  assert.equal(response.cookieOptions.expires, undefined);
});

import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import test from "node:test";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = (relativePath) => readFileSync(resolve(projectRoot, relativePath), "utf8");

class FnosDbError extends Error {
  constructor(message, status = 500) {
    super(message);
    this.name = "FnosDbError";
    this.status = status;
  }
}

const nextResponse = {
  json(body, init = {}) {
    return { body, status: init.status || 200 };
  },
};

function transpile(relativePath) {
  const filename = resolve(projectRoot, relativePath);
  return {
    filename,
    compiled: ts.transpileModule(source(relativePath), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2020,
        esModuleInterop: true,
        strict: true,
      },
      fileName: filename,
    }).outputText,
  };
}

function executeModule(relativePath, mocks = {}) {
  const { filename, compiled } = transpile(relativePath);
  const cjsModule = { exports: {} };
  const localRequire = (specifier) => {
    if (Object.hasOwn(mocks, specifier)) return mocks[specifier];
    if (specifier === "next/server") {
      return { NextRequest: class NextRequest {}, NextResponse: nextResponse };
    }
    if (specifier === "./fnos-db" || specifier === "@/lib/fnos-db") {
      return { FnosDbError };
    }
    return createRequire(filename)(specifier);
  };
  new Function("require", "exports", "module", compiled)(localRequire, cjsModule.exports, cjsModule);
  return cjsModule.exports;
}

function request({ bearer = "", automationHeader = "", session = "", url = "http://localhost/api/fnos/automation-jobs" } = {}) {
  const headers = new Headers();
  if (bearer) headers.set("authorization", `Bearer ${bearer}`);
  if (automationHeader) headers.set("x-automation-agent-token", automationHeader);
  return {
    headers,
    cookies: {
      get(name) {
        return name === "fnos_session" && session ? { value: session } : undefined;
      },
    },
    nextUrl: new URL(url),
    json: async () => ({}),
  };
}

async function withAuthEnv(values, callback) {
  const keys = ["AUTOMATION_AGENT_TOKEN", "FN_OS_AUTH_TOKEN", "FN_OS_PASSWORD"];
  const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  for (const key of keys) delete process.env[key];
  Object.assign(process.env, values);
  try {
    return await callback();
  } finally {
    for (const key of keys) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  }
}

const authModule = executeModule("src/lib/automation-agent-api.ts");

test("automation agent token is fail-closed when missing", async () => {
  await withAuthEnv({}, () => {
    assert.throws(
      () => authModule.assertAutomationAgentAuth(request()),
      (error) => error instanceof FnosDbError && error.status === 503,
    );
  });
});

test("automation agent token rejects wrong values and accepts both supported headers", async () => {
  await withAuthEnv({ AUTOMATION_AGENT_TOKEN: "test-automation-token" }, () => {
    assert.throws(
      () => authModule.assertAutomationAgentAuth(request({ bearer: "wrong-token" })),
      (error) => error instanceof FnosDbError && error.status === 401,
    );
    assert.doesNotThrow(() => authModule.assertAutomationAgentAuth(request({ bearer: "test-automation-token" })));
    assert.doesNotThrow(() => authModule.assertAutomationAgentAuth(request({ automationHeader: "test-automation-token" })));
  });
});

test("shared automation-jobs auth accepts a valid FNOS browser session without exposing worker token", async () => {
  await withAuthEnv({ FN_OS_AUTH_TOKEN: "test-session-token" }, () => {
    assert.doesNotThrow(() => authModule.assertAutomationJobAuth(request({ session: "test-session-token" })));
  });
});

test("automation-jobs list route allows the authenticated browser session", async () => {
  await withAuthEnv({ FN_OS_AUTH_TOKEN: "test-session-token" }, async () => {
    let listCalls = 0;
    const route = executeModule("src/app/api/fnos/automation-jobs/route.ts", {
      "@/lib/automation-agent-api": authModule,
      "@/lib/automation-jobs": {
        createAutomationRun: async () => ({ id: "run-1" }),
        listAutomationRunsAsJobs: async () => {
          listCalls += 1;
          return [];
        },
      },
    });
    const response = await route.GET(request({ session: "test-session-token" }));
    assert.equal(response.status, 200);
    assert.equal(listCalls, 1);
  });
});

test("automation-jobs claim is token-only even for an authenticated browser session", async () => {
  await withAuthEnv({ AUTOMATION_AGENT_TOKEN: "test-automation-token", FN_OS_AUTH_TOKEN: "test-session-token" }, async () => {
    let claimCalls = 0;
    const route = executeModule("src/app/api/fnos/automation-jobs/claim/route.ts", {
      "@/lib/automation-agent-api": authModule,
      "@/lib/automation-jobs": {
        claimNextAutomationJob: async () => {
          claimCalls += 1;
          return null;
        },
      },
    });

    const sessionResponse = await route.POST(request({ session: "test-session-token" }));
    assert.equal(sessionResponse.status, 401);
    assert.equal(claimCalls, 0);

    const tokenResponse = await route.POST(request({ automationHeader: "test-automation-token" }));
    assert.equal(tokenResponse.status, 200);
    assert.equal(claimCalls, 1);
  });
});

test("every shared automation-jobs handler has route-level auth and claim stays token-only", () => {
  const collectionRoute = source("src/app/api/fnos/automation-jobs/route.ts");
  const detailRoute = source("src/app/api/fnos/automation-jobs/[id]/route.ts");
  const claimRoute = source("src/app/api/fnos/automation-jobs/claim/route.ts");

  assert.equal((collectionRoute.match(/assertAutomationJobAuth\(request\)/g) || []).length, 2);
  assert.equal((detailRoute.match(/assertAutomationJobAuth\(request\)/g) || []).length, 2);
  assert.equal((claimRoute.match(/assertAutomationAgentAuth\(request\)/g) || []).length, 1);
  assert.ok(claimRoute.indexOf("assertAutomationAgentAuth(request)") < claimRoute.indexOf("request.json()"));
});

test("every exported handler in proxy-exempt legacy automation routes keeps fail-closed route-level auth", () => {
  const routeFiles = readdirSync(resolve(projectRoot, "src/app/api/automation"), { recursive: true })
    .map((entry) => String(entry).replaceAll("\\", "/"))
    .filter((entry) => entry.endsWith("route.ts"));
  const httpMethods = /^(GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD)$/;

  assert.ok(routeFiles.length > 0);
  for (const routeFile of routeFiles) {
    const relativePath = `src/app/api/automation/${routeFile}`;
    const routeSource = source(relativePath);
    const sourceFile = ts.createSourceFile(relativePath, routeSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    const handlers = sourceFile.statements.flatMap((statement) => {
      const isExported = statement.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword);
      if (!isExported) return [];
      if (ts.isFunctionDeclaration(statement) && statement.name && httpMethods.test(statement.name.text)) {
        return [{ method: statement.name.text, body: statement.body?.getText(sourceFile) || "" }];
      }
      if (!ts.isVariableStatement(statement)) return [];
      return statement.declarationList.declarations
        .filter((declaration) => ts.isIdentifier(declaration.name) && httpMethods.test(declaration.name.text))
        .map((declaration) => ({ method: declaration.name.text, body: declaration.initializer?.getText(sourceFile) || "" }));
    });

    assert.ok(handlers.length > 0, `${routeFile}: exported HTTP handler not found`);
    for (const handler of handlers) {
      const label = `${routeFile}:${handler.method}`;
      const guardIndex = handler.body.search(/assertAutomationAgentAuth\(request\)/);
      const firstAwaitIndex = handler.body.search(/\bawait\b/);
      const bodyReadIndex = handler.body.search(/request\.json\s*\(/);
      assert.ok(guardIndex >= 0, `${label}: missing automation auth guard`);
      if (firstAwaitIndex >= 0) assert.ok(guardIndex < firstAwaitIndex, `${label}: auth must precede awaited work`);
      if (bodyReadIndex >= 0) assert.ok(guardIndex < bodyReadIndex, `${label}: auth must precede body parsing`);
    }
  }
});

test("worker requires the automation token before polling and sends it only to remote job APIs", () => {
  const worker = source("tools/automation-worker.mjs");
  assert.match(worker, /const automationAgentToken = envValue\("AUTOMATION_AGENT_TOKEN"\)/);
  assert.match(worker, /"x-automation-agent-token": automationAgentToken/);
  assert.match(worker, /AUTOMATION_AGENT_TOKEN is required/);
  assert.ok(worker.indexOf("AUTOMATION_AGENT_TOKEN is required") < worker.indexOf("await main()"));

  assert.match(worker, /"x-fnos-api-key": requestApiKey/);
  assert.match(worker, /"x-fnos-worker-direct": "1"/);
  assert.doesNotMatch(source("src/app/automation-center.tsx"), /AUTOMATION_AGENT_TOKEN|x-automation-agent-token/);
  assert.doesNotMatch(source("src/app/page.tsx"), /AUTOMATION_AGENT_TOKEN|x-automation-agent-token/);
});

test("token comparison uses a constant-time primitive", () => {
  assert.match(source("src/lib/automation-agent-api.ts"), /timingSafeEqual/);
});

test("public env example contains placeholders only for auth and automation secrets", () => {
  const example = source(".env.example");
  assert.match(example, /^FN_OS_PASSWORD=your-/m);
  assert.match(example, /^FN_OS_AUTH_TOKEN=your-/m);
  assert.match(example, /^FN_OS_API_KEY=your-/m);
  assert.match(example, /^AUTOMATION_AGENT_TOKEN=your-/m);
  assert.doesNotMatch(example, /fn_kjw@|change-this-/);
});

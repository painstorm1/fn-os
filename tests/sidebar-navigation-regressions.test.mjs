import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import vm from "node:vm";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const pageSource = readFileSync(new URL("../src/app/page.tsx", import.meta.url), "utf8").replace(/\r\n/g, "\n");
const sidebarStart = pageSource.indexOf("function LeftSidebar(");
const sidebarEnd = pageSource.indexOf("\nfunction ToolSection(", sidebarStart);
const sidebarSource = pageSource.slice(sidebarStart, sidebarEnd);

function loadSidebarNavigationMode() {
  const start = pageSource.indexOf("function sidebarNavigationMode(");
  const end = pageSource.indexOf("\n}\n", start) + 2;
  assert.ok(start >= 0 && end > start, "sidebar navigation mode helper must remain extractable");
  const source = `${pageSource.slice(start, end)}\nmodule.exports = { sidebarNavigationMode };`;
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const cjsModule = { exports: {} };
  vm.runInNewContext(output, { module: cjsModule, exports: cjsModule.exports });
  return cjsModule.exports.sidebarNavigationMode;
}

test("sidebar soft navigation keeps the accounting upload hard boundary and exact destinations", () => {
  const sidebarNavigationMode = loadSidebarNavigationMode();
  for (const menu of ["대시보드", "매출/재고", "수입관리", "광고분석", "자동화센터", "FN 설정"]) {
    assert.equal(sidebarNavigationMode(menu), "soft", `${menu} must keep Link soft navigation`);
  }
  assert.equal(sidebarNavigationMode("회계/비용"), "document");

  assert.match(sidebarSource, /function navigateFromSidebar\(event: \{ preventDefault: \(\) => void \}, href: string\) \{\s*if \(sidebarNavigationMode\(activeMenu\) === "document"\) \{\s*event\.preventDefault\(\);\s*onNavigate\?\.\(\);\s*goToInternal\(href\);\s*return;\s*}\s*onNavigate\?\.\(\);\s*}/);
  assert.doesNotMatch(sidebarSource, /onClick=\{\(event\)/, "Link navigation must stay in onNavigate so modified/new-tab behavior remains native");
  assert.doesNotMatch(sidebarSource, /onNavigate=\{onNavigate\}/, "every ordinary sidebar Link must pass through the accounting boundary");

  assert.match(sidebarSource, /href="\/\?menu=dashboard"[\s\S]*?navigateFromSidebar\(event, "\/\?menu=dashboard"\)/);
  assert.match(sidebarSource, /href="\/\?menu=fnSettings&settingsTab=info"[\s\S]*?navigateFromSidebar\(event, "\/\?menu=fnSettings&settingsTab=info"\)/);
  assert.match(sidebarSource, /href="\/\?menu=sales&salesSection=online"[\s\S]*?navigateFromSidebar\(event, "\/\?menu=sales&salesSection=online"\)/);
  assert.match(sidebarSource, /href="\/\?menu=import"[\s\S]*?navigateFromSidebar\(event, "\/\?menu=import"\)/);
  assert.match(sidebarSource, /href="\/\?menu=ads&adsSection=overview"[\s\S]*?navigateFromSidebar\(event, "\/\?menu=ads&adsSection=overview"\)/);
  assert.match(sidebarSource, /href="\/\?menu=accounting&accountingTab=dashboard"[\s\S]*?if \(active\) \{\s*event\.preventDefault\(\);\s*setAccountingOpen\(\(open\) => !open\);\s*return;\s*}\s*navigateFromSidebar\(event, "\/\?menu=accounting&accountingTab=dashboard"\)/);
  assert.match(sidebarSource, /href=\{`\/\?menu=\$\{menuSlugs\[item\]\}`\}[\s\S]*?navigateFromSidebar\(event, `\/\?menu=\$\{menuSlugs\[item\]\}`\)/);

  for (const template of [
    "href={`/?menu=sales&salesSection=${sub.section}`}",
    "href={`/?menu=import&section=${encodeURIComponent(sub.path)}`}",
    "href={`/?menu=ads&adsSection=${sub.section}`}",
    "href={`/?menu=accounting&accountingTab=${sub.tab}`}",
  ]) {
    assert.ok(sidebarSource.includes(template), `${template} must remain exact`);
  }
  for (const [label, value] of [["대시보드", "dashboard"], ["DB작업실", "db"], ["통장/카드 내역", "ledger"], ["고정비", "fixed"]]) {
    assert.ok(pageSource.includes(`{ label: "${label}", tab: "${value}" }`));
  }

  assert.match(sidebarSource, /await fetch\("\/api\/login", \{ method: "DELETE" \}\)\.catch\(\(\) => null\);\s*window\.location\.href = "\/login";/);
  assert.match(pageSource, /localStorage\.setItem\(IMPORT_PURCHASE_PREFILL_STORAGE_KEY, JSON\.stringify\(await buildQuickImportPurchasePrefill\(order\.id\)\)\);\s*window\.location\.href = "\/\?menu=sales&salesSection=history";/);
  assert.match(pageSource, /if \(!res\.ok \|\| !json\.ok\) throw new Error\(json\.error \|\| "발주 저장에 실패했습니다\."\);\s*window\.location\.href = importHref\(id \? `\/orders\/\$\{id\}` : "\/orders"\);/);
  assert.match(pageSource, /if \(!uploading\) return;[\s\S]*?window\.addEventListener\("beforeunload", handleBeforeUnload\);\s*return \(\) => window\.removeEventListener\("beforeunload", handleBeforeUnload\);\s*}, \[uploading\]\);/);
  assert.match(pageSource, /function goToInternal\(href: string\) \{\s*window\.location\.href = href;\s*}/);
});

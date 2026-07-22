import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";
import vm from "node:vm";

const require = createRequire(import.meta.url);
const ts = require("typescript");

const pageSource = readFileSync(new URL("../src/app/page.tsx", import.meta.url), "utf8");
const viewerSource = readFileSync(new URL("../src/app/attachment-viewer/page.tsx", import.meta.url), "utf8");

test("Excel attachments use the native attachment viewer without Google conversion", () => {
  const openStart = pageSource.indexOf("function openAttachment(");
  const openEnd = pageSource.indexOf("\nfunction fmtPct", openStart);
  assert.notEqual(openStart, -1);
  assert.notEqual(openEnd, -1);
  const openSource = pageSource.slice(openStart, openEnd);

  assert.match(openSource, /const url = attachmentViewerUrl\(item\);/);
  assert.doesNotMatch(openSource, /isExcelAttachment|attachment-sheet|sessionStorage|openingAttachmentSheets|fetch\(/);
  assert.doesNotMatch(pageSource, /\/api\/google\/attachment-sheet/);
  assert.match(openSource, /if \(!url\) \{[\s\S]*첨부파일 URL이 없습니다/);
  assert.match(openSource, /const opened = window\.open\(url, "_blank", "noopener,noreferrer"\);[\s\S]*if \(!opened\) alert\("팝업이 차단되었습니다/);

  assert.match(viewerSource, /return \["xlsx", "xls", "xlsm", "csv"\]\.includes\(ext\);/);
  assert.match(viewerSource, /isSpreadsheet\(ext\) \? \([\s\S]*<SpreadsheetPreview url=\{url\} name=\{name\} \/>/);
});

test("attachment file URLs use the numeric order proxy and raw URLs for UUID account files", () => {
  const helperStart = pageSource.indexOf("function attachmentRawFileUrl(");
  const helperEnd = pageSource.indexOf("\nfunction FileTypeIcon", helperStart);
  assert.notEqual(helperStart, -1);
  assert.notEqual(helperEnd, -1);

  const output = ts.transpileModule(pageSource.slice(helperStart, helperEnd), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
  }).outputText;
  const sandbox = {};
  vm.runInNewContext(`${output}\nglobalThis.helpers = { attachmentFileUrl };`, sandbox);

  assert.equal(sandbox.helpers.attachmentFileUrl({ id: 123, file_url: "https://storage.example/order.xlsx" }), "/api/fnos/attachments/123/file");
  assert.equal(sandbox.helpers.attachmentFileUrl({ id: "456", file_url: "https://storage.example/order.xlsx" }), "/api/fnos/attachments/456/file");
  assert.equal(sandbox.helpers.attachmentFileUrl({ id: "account-file-uuid", file_url: "https://storage.example/account.xlsx" }), "https://storage.example/account.xlsx");
  assert.equal(sandbox.helpers.attachmentFileUrl({ id: "", file_path: "https://storage.example/path.xlsx" }), "https://storage.example/path.xlsx");
});

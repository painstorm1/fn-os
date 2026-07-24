import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const fnUiSource = readFileSync(new URL("../src/components/fn-ui.tsx", import.meta.url), "utf8");
const globalsSource = readFileSync(new URL("../src/app/globals.css", import.meta.url), "utf8");
const pageSource = readFileSync(new URL("../src/app/page.tsx", import.meta.url), "utf8");
const dashboardSource = readFileSync(new URL("../src/app/main-dashboard.tsx", import.meta.url), "utf8");
const automationSource = readFileSync(new URL("../src/app/automation-center.tsx", import.meta.url), "utf8");
const loginSource = readFileSync(new URL("../src/app/login/page.tsx", import.meta.url), "utf8");

test("shared UI exports the required small primitives and notice host", () => {
  for (const name of ["Input", "Select", "Textarea", "Checkbox", "Tabs", "TableShell", "InlineNotice", "LoadingState", "NoticeHost"]) {
    assert.match(fnUiSource, new RegExp(`export (?:const|function) ${name}\\b`), `${name} must be exported`);
  }
  assert.match(fnUiSource, /export function notify\b/);
  assert.match(fnUiSource, /event\.key === "ArrowRight"/);
  assert.match(fnUiSource, /event\.key === "Home"/);
});

test("shared modals own dialog semantics, top-modal keyboard behavior, focus restore, and scroll lock", () => {
  assert.match(fnUiSource, /role="dialog"/);
  assert.match(fnUiSource, /aria-modal="true"/);
  assert.match(fnUiSource, /aria-labelledby=/);
  assert.match(fnUiSource, /aria-describedby=/);
  assert.match(fnUiSource, /useId\(/);
  assert.match(fnUiSource, /modalStack/);
  assert.match(fnUiSource, /event\.key !== "Tab"/);
  assert.match(fnUiSource, /previousFocus/);
  assert.match(fnUiSource, /document\.body\.style\.overflow = "hidden"/);
});

test("global controls have one visible focus rule, checkbox normalization, and reduced-motion fallback", () => {
  assert.match(globalsSource, /input:focus-visible/);
  assert.match(globalsSource, /select:focus-visible/);
  assert.match(globalsSource, /textarea:focus-visible/);
  assert.match(globalsSource, /input\[type="checkbox"\]:not\(\[class~="hidden"\]\)/);
  assert.match(globalsSource, /prefers-reduced-motion: reduce/);
});

test("app shell exposes mobile navigation, current location, shared loading, and one notice host", () => {
  assert.match(pageSource, /aria-controls="fnos-mobile-navigation"/);
  assert.match(pageSource, /id=\{mobile \? "fnos-mobile-navigation"/);
  assert.match(pageSource, /aria-current=/);
  assert.match(pageSource, /aria-expanded=/);
  assert.match(pageSource, /<NoticeHost \/>/);
  assert.match(pageSource, /loading: \(\) => <LoadingState/);
  assert.match(pageSource, /<Suspense fallback=\{<LoadingState/);
});

test("large sales sheets use React state and shared dialogs instead of peer checkboxes", () => {
  assert.doesNotMatch(pageSource, /online-(?:shipping|sales|purchase)-sheet-toggle/);
  assert.match(pageSource, /salesSheetModal/);
  assert.match(pageSource, /size="screen"/);
  assert.match(pageSource, /salesSheetModal === "shipping"/);
  assert.match(pageSource, /salesSheetModal === "sales"/);
  assert.match(pageSource, /salesSheetModal === "purchase"/);
});

test("dashboard, accounting, settings, automation, ads, and login adopt shared feedback and controls", () => {
  assert.match(dashboardSource, /<PageHeader/);
  assert.match(dashboardSource, /<LoadingState/);
  assert.match(dashboardSource, /<InlineNotice/);
  assert.match(pageSource, /<Tabs[\s\S]*value=\{ledgerMode\}/);
  assert.match(pageSource, /<Tabs[\s\S]*value=\{activeTab\}/);
  assert.match(pageSource, /<PageHeader title=.* description=/);
  assert.match(automationSource, /<InlineNotice/);
  assert.match(automationSource, /<LoadingState/);
  assert.match(loginSource, /<Input/);
  assert.match(loginSource, /<ActionButton/);
  assert.match(loginSource, /<InlineNotice/);
  assert.doesNotMatch(loginSource, /window\.alert/);
});

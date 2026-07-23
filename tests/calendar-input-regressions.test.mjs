import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";
import ts from "typescript";

const helperSource = readFileSync(new URL("../src/lib/calendar-input.ts", import.meta.url), "utf8");
const componentSource = readFileSync(new URL("../src/components/fn-ui.tsx", import.meta.url), "utf8");
const pageSource = readFileSync(new URL("../src/app/page.tsx", import.meta.url), "utf8");

function loadHelpers() {
  const module = { exports: {} };
  const output = ts.transpileModule(helperSource, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(output, { module, exports: module.exports }, { filename: "calendar-input.js" });
  return module.exports;
}

test("calendar input normalizes supported date and month forms", () => {
  const { normalizeCalendarInput, formatCalendarInputValue } = loadHelpers();
  for (const value of ["20260723", "2026/07/23", "2026-07-23"]) {
    assert.equal(normalizeCalendarInput(value, "date"), "2026-07-23");
  }
  for (const value of ["202607", "2026/07", "2026-07"]) {
    assert.equal(normalizeCalendarInput(value, "month"), "2026-07");
  }
  assert.equal(formatCalendarInputValue("2026-07-23", "date"), "2026/07/23");
  assert.equal(formatCalendarInputValue("2026-07", "month"), "2026/07");
  assert.equal(normalizeCalendarInput("", "date"), "");
});

test("calendar input validates real dates, leap years, and min/max", () => {
  const { normalizeCalendarInput } = loadHelpers();
  assert.equal(normalizeCalendarInput("2024-02-29", "date"), "2024-02-29");
  for (const value of ["2026-02-29", "2026-02-30", "2026-13-01", "2026-00-01"]) {
    assert.equal(normalizeCalendarInput(value, "date"), null);
  }
  for (const value of ["2026-13", "2026-00", "2026/7", "20267"]) {
    assert.equal(normalizeCalendarInput(value, "month"), null);
  }
  assert.equal(normalizeCalendarInput("2026-07-23", "date", "2026-07-01", "2026-07-31"), "2026-07-23");
  assert.equal(normalizeCalendarInput("2026-06-30", "date", "2026-07-01", "2026-07-31"), null);
  assert.equal(normalizeCalendarInput("2026-08", "month", undefined, "2026-07"), null);
});

test("CalendarInput owns the only React native picker and exposes the required contract", () => {
  assert.match(componentSource, /export const CalendarInput\s*=\s*forwardRef/);
  assert.match(componentSource, /inputMode="numeric"/);
  assert.match(componentSource, /tabIndex=\{-1\}/);
  assert.match(componentSource, /aria-label=\{mode === "month"/);
  assert.match(componentSource, /type=\{mode\}/);
  assert.match(componentSource, /typeof picker\.showPicker === "function"/);
  assert.match(componentSource, /else picker\.click\(\)/);
  assert.match(componentSource, /if \(!commit\(event\.currentTarget\.value\)\) \{[\s\S]{0,100}return;/);
  assert.match(componentSource, /type="hidden" name=\{name\} value=\{confirmedValue\} disabled=\{disabled\}/);
});

test("import order stage dates do not layer the text field over CalendarInput controls", () => {
  const laneStart = pageSource.indexOf("function StageProgressLane");
  const laneEnd = pageSource.indexOf("\nfunction NativeImportDashboard", laneStart);
  const laneSource = pageSource.slice(laneStart, laneEnd);
  const calendarTags = Array.from(laneSource.matchAll(/<CalendarInput\b[\s\S]*?\/>/g), (match) => match[0]);

  assert.equal(calendarTags.length, 1);
  assert.doesNotMatch(calendarTags[0], /className="[^"]*\b(?:relative|z-\d+)\b/);
  assert.match(calendarTags[0], /onValueChange=\{\(nextValue\) => onChange\(stage\.name, nextValue\)\}/);
});

test("all page date/month callers use CalendarInput, with only generated hidden pickers allowlisted", () => {
  const tags = Array.from(pageSource.matchAll(/<input\b[^>]*\btype=(?:"(?:date|month)"|\{["'](?:date|month)["']\})[^>]*>/gs), (match) => match[0]);
  const forbidden = tags.filter((tag) => !tag.includes("data-calendar-picker"));
  assert.deepEqual(forbidden, []);

  const popupStart = pageSource.indexOf("async function openTradeAnalysisPopup");
  const popupEnd = pageSource.indexOf("\n  async function", popupStart + 30);
  const outsidePopup = pageSource.slice(0, popupStart) + pageSource.slice(popupEnd);
  assert.doesNotMatch(outsidePopup, /\.showPicker\s*\(/);
  assert.doesNotMatch(pageSource, /datePickerOpenRef|formatDateDigitsInput/);
  assert.match(pageSource, /if \(config\.inputType === "date"\)[\s\S]{0,180}<CalendarInput/);
  for (const field of ["companyDraft.representative_birth", "companyDraft.opened_at", "locationDraft.rent_started_at"]) {
    const index = pageSource.indexOf(`value={${field}}`);
    assert.notEqual(index, -1);
    assert.match(pageSource.slice(Math.max(0, index - 180), index + 220), /CalendarInput/);
  }
});

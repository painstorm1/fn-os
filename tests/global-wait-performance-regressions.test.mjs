import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const page = readFileSync(new URL("../src/app/page.tsx", import.meta.url), "utf8");
const login = readFileSync(new URL("../src/app/login/page.tsx", import.meta.url), "utf8");
const fnUi = readFileSync(new URL("../src/components/fn-ui.tsx", import.meta.url), "utf8");

function section(startMarker, endMarker) {
  const start = page.indexOf(startMarker);
  const end = page.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(start, -1, `missing source marker: ${startMarker}`);
  assert.notEqual(end, -1, `missing source marker: ${endMarker}`);
  return page.slice(start, end);
}

test("source contract: global waits are visible and only the two safe F2 callers use client navigation", () => {
  const f2 = section("function useF2Navigate", "type CheckboxSelectionMode");
  assert.match(f2, /const router = useRouter\(\);/);
  assert.match(f2, /target instanceof HTMLInputElement[\s\S]*?HTMLTextAreaElement[\s\S]*?HTMLSelectElement[\s\S]*?HTMLButtonElement/);
  assert.match(f2, /event\.preventDefault\(\);\s*router\.push\(href\);/);
  assert.doesNotMatch(f2, /window\.location/);
  assert.deepEqual(page.replace(f2, "").match(/useF2Navigate\([^\n]+\);/g), [
    'useF2Navigate(true, importHref("/orders/new"));',
    'useF2Navigate(true, importHref(`/products/new?tab=${tab}`));',
  ]);

  const nativeProducts = section("function NativeProducts", "function useImportFormData");
  assert.match(nativeProducts, /const \[tab, setTab\] = useState<ImportProductTab>\(initialTab\);\s*useF2Navigate\(true, importHref\(`\/products\/new\?tab=\$\{tab\}`\)\);/);
  assert.match(nativeProducts, /<Link [^>]*href=\{importHref\(`\/products\/new\?tab=\$\{tab\}`\)\}>F2 새 제품<\/Link>/);

  const goToInternal = section("function goToInternal", "function replaceCurrentQueryParam");
  const productForm = section("function NativeProductForm", "function NativeOrderDetail");
  const orderDetail = section("function NativeOrderDetail", "function NativeOrderForm");
  const orderForm = section("function NativeOrderForm", "function NativeSettings");
  assert.match(goToInternal, /window\.location\.href = href;/);
  assert.match(page, /async function logout\(\)[\s\S]*?window\.location\.href = "\/login";/);
  assert.match(login, /window\.location\.href = params\.get\("next"\) \|\| "\/";/);
  assert.equal(productForm.match(/window\.location\.href = productListHref\(\);/g)?.length, 2);
  assert.match(orderDetail, /window\.location\.href = importHref\("\/orders"\);/);
  assert.equal(orderForm.match(/window\.location\.href = importHref\("\/orders"\);/g)?.length, 2);
  assert.match(orderForm, /localStorage\.setItem\(IMPORT_PURCHASE_PREFILL_STORAGE_KEY,[\s\S]*?window\.location\.href = "\/\?menu=sales&salesSection=history";/);

  const dynamicImports = section("const MainDashboard", "type XlsxModule");
  assert.match(fnUi, /export function LoadingState[\s\S]*?role="status"[\s\S]*?aria-live="polite"/);
  assert.equal(dynamicImports.match(/loading: \(\) => <LoadingState/g)?.length, 2);
  for (const [start, end, loadingBranch] of [
    ["function NativeOrders", "function NativeOrderQuickEditor", "loading"],
    ["function NativeProducts", "function useImportFormData", "loading"],
    ["function NativeProductForm", "function NativeOrderDetail", "loading || detailLoading"],
    ["function NativeOrderDetail", "function NativeOrderForm", "loading"],
    ["function NativeOrderForm", "function NativeSettings", "loading || detailLoading"],
  ]) {
    assert.match(section(start, end), new RegExp(`${loadingBranch.replaceAll("|", "\\|")} \\? <LoadingState `));
  }
  assert.match(page.slice(page.indexOf("export default function Home")), /<Suspense fallback=\{<LoadingState /);
});

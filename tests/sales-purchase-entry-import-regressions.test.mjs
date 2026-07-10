import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const salesInventorySource = readFileSync(new URL("../src/lib/sales-inventory.ts", import.meta.url), "utf8");
const dashboardSource = readFileSync(new URL("../src/lib/main-dashboard.ts", import.meta.url), "utf8");
const partnerBalancesSource = readFileSync(new URL("../src/lib/partner-balances.ts", import.meta.url), "utf8");
const pageSource = readFileSync(new URL("../src/app/page.tsx", import.meta.url), "utf8");

test("sales/purchase imports force today and no longer require spreadsheet date", () => {
  assert.match(salesInventorySource, /function importEntryDate[\s\S]*options\?\.forceToday \? todayCompact\(\)/);
  assert.match(salesInventorySource, /importSalesRows[\s\S]*salesInventoryEntryRequiredError\(row, "sales", index, \{ requireDate: false \}\)/);
  assert.match(salesInventorySource, /importSalesRows[\s\S]*normalizeSale\(row, index, batch\.id, sourceFileName, \{ forceToday: true \}\)/);
  assert.match(salesInventorySource, /importPurchaseRows[\s\S]*salesInventoryEntryRequiredError\(row, "purchases", index, \{ requireDate: false \}\)/);
  assert.match(salesInventorySource, /importPurchaseRows[\s\S]*normalizePurchase\(row, index, batch\.id, sourceFileName, \{ forceToday: true \}\)/);
});

test("uploaded sales/purchase batches are grouped by date and customer, not by whole batch", () => {
  for (const source of [salesInventorySource, dashboardSource, partnerBalancesSource, pageSource]) {
    assert.match(source, /batch-entry/);
    assert.match(source, /upload_batch_id/);
  }
  assert.match(salesInventorySource, /filters\.cust_code = `eq\.\$\{customerCode\}`;[\s\S]*filters\.cust_name = `eq\.\$\{customerName\}`;/);
  assert.match(pageSource, /function batchEntryRowKey[\s\S]*\["batch-entry", batchId, date, customerCode, customerName\]/);
  assert.doesNotMatch(pageSource, /entry_group_key \|\| \(batchId \? `batch:\$\{batchId\}`/);
});

test("online order FN sales/purchase input uses today and does not require row date", () => {
  assert.match(pageSource, /"FN판매입력": \["거래처코드", "거래처명", "출하창고", "품목코드", "품목명", "수량"\]/);
  assert.match(pageSource, /"FN구매입력": \["거래처코드", "거래처명", "입고창고", "품목코드", "품목명", "수량"\]/);
  assert.match(pageSource, /const date = entryDateToday\(\)\.replace\(\/\\D\/g, ""\);/);
  assert.match(pageSource, /일자: entryDateToday\(\),[\s\S]*거래처코드: item\.거래처코드/);
  assert.doesNotMatch(pageSource, /salesCellText\(item\.일자\)[\s\S]{0,80}salesCellText\(warehouse\)/);
});

test("direct entry Excel upload preserves row-level customer and warehouse metadata", () => {
  assert.match(pageSource, /type SalesPurchaseEntryLine = \{[\s\S]*entryDate\?: string;[\s\S]*customerCode\?: string;[\s\S]*customerText\?: string;[\s\S]*warehouseCode\?: string;[\s\S]*vatMode\?: SalesPurchaseVatMode;/);
  assert.match(pageSource, /if \(!\(pick\(row, "거래처코드"\) \|\| pick\(row, "거래처명"\)\)\) missing\.push\("거래처코드\/거래처명"\);/);
  assert.match(pageSource, /importedLines\.push\(\{[\s\S]*entryDate: rowDate,[\s\S]*customerCode: rowCustomerCode,[\s\S]*customerText: rowCustomerText,[\s\S]*warehouseCode: rowWarehouse,[\s\S]*vatMode: rowVatMode/);
  assert.match(pageSource, /const lineCustomerCode = \(line: SalesPurchaseEntryLine\) => line\.customerCode \?\? customerCode;/);
  assert.match(pageSource, /cust_code: lineCustomerCode\(line\),[\s\S]*cust_name: lineCustomerText\(line\),[\s\S]*wh_cd: lineWarehouseCode\(line\)/);
});

test("FN purchase entry uses supply amount instead of a separate visible unit-price column", () => {
  assert.match(pageSource, /"FN구매입력": \["일자", "거래처코드", "거래처명", "입고창고", "VAT 포함\/별도", "품목코드", "품목명", "수량", "공급가액", "합계금액", "메모"\]/);
  assert.doesNotMatch(pageSource, /"FN구매입력": \[[^\]]*"단가"/);
  assert.match(pageSource, /const price = rawPrice \|\| supply;/);
  assert.match(salesInventorySource, /const price = rawPrice \|\| explicitSupply;/);
});

test("direct-shipping purchase input appends grouped delivery fee rows by recipient phone and address", () => {
  assert.match(pageSource, /directShippingDeliveryFeeUnit[\s\S]*케이모아: 4500,[\s\S]*JB: 2500/);
  assert.match(pageSource, /directShippingDeliveryFeeProduct[\s\S]*code: "ETC_01",[\s\S]*name: "직송 배송비"/);
  assert.match(pageSource, /function directShippingDeliveryIdentity[\s\S]*progressValue\(row, "수취인"\)[\s\S]*progressValue\(row, "수취인연락처1"\) \|\| progressValue\(row, "수취인연락처2"\)[\s\S]*progressValue\(row, "주소"\)/);
  assert.match(pageSource, /function directShippingDeliveryCount[\s\S]*identities\.add\(directShippingDeliveryIdentity\(row, sourceIndex\)\)/);
  assert.match(pageSource, /async function sendPurchaseInput\(\)[\s\S]*await buildDirectShippingPurchaseRows\(sheets\["FN구매입력"\], sheets\["발주 진행 단계"\], directShippingSourceIndexes\)/);
  assert.match(pageSource, /purchaseOverrideRows = sourceRows[\s\S]*__purchaseOverrideCandidate === "1" && !directShippingDeliveryFeeRowMatch\(item\)/);
  assert.match(pageSource, /directRows\.push\(directShippingPurchaseRecordToRow\(directShippingDeliveryFeeRecord\(feePartner, deliveryCount\)\)\)/);
});

test("online sales/purchase save avoids per-row inventory-current updates and post-save busy overlay", () => {
  assert.match(salesInventorySource, /function inventoryMovementUpdateKey\(row: RawRow\)/);
  assert.match(salesInventorySource, /async function updateCurrentInventoryForMovements\(movementPairs: Array<\{ sourceRow: RawRow; movement: RawRow \}>\)/);
  assert.match(salesInventorySource, /current\.deltaQty \+= deltaQty/);
  assert.match(salesInventorySource, /const batchSize = 12;[\s\S]*await Promise\.all\(batch\.map\(\(item\) => updateCurrentInventory\(item\.sourceRow, item\.deltaQty\)\)\)/);
  assert.match(salesInventorySource, /await updateCurrentInventoryForMovements\(movementPairs\);/);
  assert.doesNotMatch(salesInventorySource, /Promise\.all\(movementPairs\.map\(\(pair\) => updateCurrentInventory/);
  assert.match(pageSource, /function loadSummary\(force = false, options\?: \{ skipBusyOverlay\?: boolean \}\)/);
  assert.match(pageSource, /loadSummary\(true, \{ skipBusyOverlay: true \}\);/);
});

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const salesInventorySource = readFileSync(new URL("../src/lib/sales-inventory.ts", import.meta.url), "utf8");
const dashboardSource = readFileSync(new URL("../src/lib/main-dashboard.ts", import.meta.url), "utf8");
const partnerBalancesSource = readFileSync(new URL("../src/lib/partner-balances.ts", import.meta.url), "utf8");
const pageSource = readFileSync(new URL("../src/app/page.tsx", import.meta.url), "utf8");
const productMasterSource = readFileSync(new URL("../src/app/api/fnos/products/master/route.ts", import.meta.url), "utf8");
const purchaseVoucherMergeSource = readFileSync(new URL("../src/lib/purchase-voucher-merge.ts", import.meta.url), "utf8");
const purchaseVoucherMergeRouteSource = readFileSync(new URL("../src/app/api/purchases/import/merge/route.ts", import.meta.url), "utf8");

test("sales/purchase imports preserve provided dates and still accept missing dates", () => {
  assert.match(salesInventorySource, /function importEntryDate\(row: RawRow, keys: string\[\]\)[\s\S]*text\(first\(row, keys\)\) \|\| todayCompact\(\)/);
  assert.match(salesInventorySource, /importSalesRows[\s\S]*salesInventoryEntryRequiredError\(row, "sales", index, \{ requireDate: false \}\)/);
  assert.match(salesInventorySource, /importSalesRows[\s\S]*normalizeSale\(row, index, batch\.id, sourceFileName\)/);
  assert.match(salesInventorySource, /importPurchaseRows[\s\S]*salesInventoryEntryRequiredError\(row, "purchases", index, \{ requireDate: false \}\)/);
  assert.match(salesInventorySource, /importPurchaseRows[\s\S]*normalizePurchase\(row, index, batch\.id, sourceFileName\)/);
  assert.doesNotMatch(salesInventorySource, /forceToday/);
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

test("purchase management can merge same-date same-vendor vouchers into one statement group", () => {
  assert.match(pageSource, /function purchaseVoucherDateKey[\s\S]*entryDateFilterKey\(entryRowDate\(row\)\)/);
  assert.match(pageSource, /function purchaseVoucherCustomerName[\s\S]*cust_name \|\| row\.customer_name \|\| row\.supplier_name/);
  assert.match(pageSource, /async function mergePurchaseVouchers[\s\S]*targetRows\.length < 2/);
  assert.match(pageSource, /window\.alert\("일자, 구매처명이 동일하지 않아서 전표통합 불가능"\)/);
  assert.match(pageSource, /fetch\("\/api\/purchases\/import\/merge"/);
  assert.match(pageSource, /window\.alert\("전표통합 성공"\)/);
  assert.match(pageSource, /mode === "purchases" && !isReturnHistory[\s\S]*>전표통합<\/ActionButton>/);
  assert.match(purchaseVoucherMergeRouteSource, /mergePurchaseEntryGroups\(groupKeys\)/);
  assert.match(purchaseVoucherMergeRouteSource, /message: "전표통합 성공"/);
  assert.match(purchaseVoucherMergeSource, /export async function mergePurchaseEntryGroups\(groupKeys: string\[\]\)/);
  assert.match(purchaseVoucherMergeSource, /uniqueGroupKeys\.length < 2/);
  assert.match(purchaseVoucherMergeSource, /throw new Error\("일자, 구매처명이 동일하지 않아서 전표통합 불가능"\)/);
  assert.match(purchaseVoucherMergeSource, /createUploadBatch\("purchases", "FN_OS_PURCHASE_VOUCHER_MERGE", rows\.length\)/);
  assert.match(purchaseVoucherMergeSource, /patchRows<RawRow>\("purchases", \{ id: `eq\.\$\{id\}` \}, \{[\s\S]*upload_batch_id: batch\.id[\s\S]*upload_ser_no: String\(index \+ 1\)[\s\S]*cust_code: canonicalCode[\s\S]*cust_name: canonicalName/);
  assert.doesNotMatch(purchaseVoucherMergeSource, /deleteRows\("purchases"|importPurchaseRows\(/);
});

test("online order FN sales/purchase input uses today and does not require row date", () => {
  assert.match(pageSource, /"FN판매입력": \["거래처코드", "거래처명", "출하창고", "품목코드", "품목명", "수량"\]/);
  assert.match(pageSource, /"FN구매입력": \["거래처코드", "거래처명", "입고창고", "품목코드", "품목명", "수량"\]/);
  assert.match(pageSource, /return header !== warehouseHeader && header !== "수량" && header !== "메모";/);
  assert.match(pageSource, /onDoubleClick=\{\(\) => \{\s*if \(!lockedCell\) setEditing\(\{ row: rowIndex, col: colIndex \}\);\s*\}\}/);
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

test("direct sales/purchase statement save uses the user-selected statement date", () => {
  const saveRowsStart = pageSource.indexOf("  async function saveRows()");
  assert.notEqual(saveRowsStart, -1);
  const saveRowsSource = pageSource.slice(saveRowsStart, pageSource.indexOf("  const allLinesSelected", saveRowsStart));
  assert.match(saveRowsSource, /const fallbackEntryDate = entryDate;/);
  assert.match(saveRowsSource, /const lineEntryDate = \(line: SalesPurchaseEntryLine\) => line\.entryDate \|\| fallbackEntryDate;/);
  assert.match(saveRowsSource, /io_date: effectiveDate,[\s\S]*sale_date: mode !== "purchases" \? effectiveDate : "",[\s\S]*purchase_date: mode === "purchases" \? effectiveDate : ""/);
  assert.doesNotMatch(saveRowsSource, /fallbackEntryDate = mode === "returns" \? entryDate : entryDateToday\(\)/);
});

test("direct sales/purchase entry narrows reference lookups before F4 save", () => {
  assert.match(salesInventorySource, /async function referenceRowsForEntries\(rows: RawRow\[\]\)[\s\S]*lookupReferenceRows\("customers"[\s\S]*lookupReferenceRows\("products"[\s\S]*lookupReferenceRows\("warehouses"/);
  assert.match(salesInventorySource, /const \[customers, products, warehouses\] = await referenceRowsForEntries\(rows\);/);
  assert.match(salesInventorySource, /function sqlInFilter\(values: string\[\]\)[\s\S]*in\.\(\$\{values\.map/);
  assert.doesNotMatch(salesInventorySource, /const \[customers, products, warehouses\] = await Promise\.all\(\[\s*referenceRows\("customers"\),\s*referenceRows\("products"\),\s*referenceRows\("warehouses"\),\s*\]\);/);
});

test("product search selection returns focus to quantity field", () => {
  assert.match(pageSource, /body: JSON\.stringify\(\{ query: keyword, productAttribute: attributeFilter, includeInventory: false, limit: 50 \}\)/);
  assert.match(pageSource, /setProductSearch\(\(prev\) => \(\{ \.\.\.prev, open: false \}\)\);[\s\S]*focusLineField\(productSearch\.lineIndex, "qty"\);/);
  assert.doesNotMatch(pageSource, /function focusProductName/);
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
  assert.match(pageSource, /async function buildDirectShippingPurchaseRows\([\s\S]*options\?: \{ enrich\?: boolean \}/);
  assert.match(pageSource, /if \(options\?\.enrich !== false\) \{[\s\S]*enrichedPurchaseSourceRows = await enrichOnlineEntryRows\(purchaseSourceRows, "purchases"\)/);
  const sendPurchaseStart = pageSource.indexOf("  async function sendPurchaseInput()");
  const sendPurchasePreflight = pageSource.slice(sendPurchaseStart, pageSource.indexOf("    const missingRequired", sendPurchaseStart));
  assert.match(sendPurchasePreflight, /const purchaseInputRows = sheets\["FN구매입력"\];/);
  assert.doesNotMatch(sendPurchasePreflight, /buildDirectShippingPurchaseRows|setSheets\(\(prev\) => \(\{ \.\.\.prev, "FN구매입력": purchaseInputRows \}\)\)/);
  assert.match(pageSource, /purchaseOverrideRows = sourceRows[\s\S]*__purchaseOverrideCandidate === "1" && !directShippingDeliveryFeeRowMatch\(item\)/);
  assert.match(pageSource, /directRows\.push\(directShippingPurchaseRecordToRow\(directShippingDeliveryFeeRecord\(feePartner, deliveryCount\)\)\)/);
});

test("online sales/purchase save avoids per-row inventory-current updates and post-save busy overlay", () => {
  assert.match(salesInventorySource, /function inventoryMovementUpdateKey\(row: RawRow\)/);
  assert.match(salesInventorySource, /async function updateCurrentInventoryForMovements\(movementPairs: Array<\{ sourceRow: RawRow; movement: RawRow \}>\)/);
  assert.match(salesInventorySource, /current\.deltaQty \+= deltaQty/);
  assert.match(salesInventorySource, /const batchSize = 12;[\s\S]*await Promise\.all\(batch\.map\(\(item\) => updateCurrentInventory\(item\.sourceRow, item\.deltaQty\)\)\)/);
  assert.match(salesInventorySource, /await updateCurrentInventoryForMovements\(movementPairs\);/);
  assert.match(salesInventorySource, /warehouse_id: text\(item\.row\.warehouse_id\) \|\| null/);
  assert.doesNotMatch(salesInventorySource, /writeInventoryMovements\([\s\S]{0,120}\.catch\(\(\) => 0\)/);
  assert.doesNotMatch(salesInventorySource, /Promise\.all\(movementPairs\.map\(\(pair\) => updateCurrentInventory/);
  assert.match(pageSource, /function loadSummary\(force = false, options\?: \{ skipBusyOverlay\?: boolean \}\)/);
  assert.match(pageSource, /loadSummary\(true, \{ skipBusyOverlay: true \}\);/);
});

test("inventory status/history uses durable identity and reverses deleted sales or purchases", () => {
  assert.match(salesInventorySource, /async function findProduct\(row: RawRow\)[\s\S]*const productId = text\(row\.product_id\)/);
  assert.match(salesInventorySource, /async function findWarehouse\(row: RawRow\)[\s\S]*const warehouseId = text\(row\.warehouse_id\)/);
  assert.match(salesInventorySource, /next\.warehouse_id = text\(warehouse\.id\) \|\| null/);
  assert.match(salesInventorySource, /if \(deleted\.length\) await reverseDeletedEntryInventoryMovements\(table, deleted\)/);
  assert.match(salesInventorySource, /movementRowsForDeletedEntries\(table: "sales" \| "purchases", deletedRows: RawRow\[\]\)/);
  assert.match(salesInventorySource, /movement_type: `\$\{text\(movement\.movement_type\) \|\| "movement"\}_delete_reversal`/);
  assert.match(salesInventorySource, /source_type: "inventory_manual"/);
  assert.match(productMasterSource, /function parseInventoryHistoryMemo\(value: unknown\)/);
  assert.match(productMasterSource, /salesRowsForMovementFallback, purchaseRowsForMovementFallback/);
  assert.match(productMasterSource, /sourceRowsByRef\.get\(text\(movement\.source_ref_id\)\)/);
  assert.match(productMasterSource, /movementType === "warehouse_transfer" \|\| text\(meta\.kind\) === "warehouse_transfer"/);
  assert.match(productMasterSource, /applyAsOfDelta\(productKeys, fromWh, movement, qty\)/);
  assert.match(productMasterSource, /applyAsOfDelta\(productKeys, toWh, movement, -qty\)/);
});

test("RG/SET products keep parent sales rows but inventory consumes BOM components", () => {
  assert.match(salesInventorySource, /function isVirtualInventoryProduct\(row: RawRow \| null \| undefined\)/);
  assert.match(salesInventorySource, /activeBomItems\(productId\)/);
  assert.match(salesInventorySource, /validateVirtualInventoryBomRows\(referenceResult\.rows\)/);
  assert.match(salesInventorySource, /return virtualInventoryProduct \? \[\] : \[\{ row, movementType: fallbackMovementType \}\]/);
  assert.match(salesInventorySource, /movementType: "bom_consume"/);
  assert.match(salesInventorySource, /expandBomInventoryRows\(row, "return_in", "return_in"\)/);
  assert.match(salesInventorySource, /parent_prod_cd: productCode\(product\)/);
  assert.match(salesInventorySource, /sku: text\(item\.row\.prod_cd \|\| item\.row\.product_code \|\| item\.row\.sku\)/);
  assert.match(salesInventorySource, /writeInventoryMovements\(saved, "sale_out"\)/);
  assert.doesNotMatch(salesInventorySource, /importPurchaseRows[\s\S]{0,900}expandBomInventoryRows/);
});

test("RG/SET inventory displays are hidden and 30/90 day stats use stock-out movements", () => {
  assert.match(dashboardSource, /optionalRows\("inventory_movements", \{ order: "movement_date\.desc", limit: 10000 \}\)/);
  assert.match(dashboardSource, /inventorySalesMovements = inventoryMovements\.filter\(\(row\) => \/\^\(sale_out\|bom_consume\|exchange_out\)\$\/i\.test\(text\(row\.movement_type\)\) && numberValue\(row\.qty\) < 0\)/);
  assert.match(dashboardSource, /inventory_sales_basis: inventorySalesMovements\.slice\(0, 10000\)/);
  assert.match(pageSource, /inventory_sales_basis\?: Array<Record<string, unknown>>/);
  assert.match(pageSource, /row\.movement_date \|\| row\.created_at/);
  assert.match(pageSource, /movementType && !\/\^\(sale_out\|bom_consume\|exchange_out\)\$\/i\.test\(movementType\)/);
  assert.match(pageSource, /const qty = Math\.abs\(salesRowQty\(row\)\)/);
  assert.match(pageSource, /summary\?\.inventory_sales_basis \|\| summary\?\.recent_inventory_movements \|\| summary\?\.sales_inventory_basis/);
  assert.match(pageSource, /inventoryProducts\.filter\(\(product\) => !isVirtualInventoryProduct\(product\)\)\.flatMap/);
  assert.match(pageSource, /function productChannelStockText\(product: FnProduct\)[\s\S]*if \(isVirtualInventoryProduct\(product\)\) return "-";/);
  assert.match(pageSource, /const inventory = virtualInventoryProduct \? \[\] : usableWarehouses/);
  assert.match(pageSource, /const virtualInventoryProduct = isVirtualInventoryProduct\(\{ product_attribute: productAttribute, product_kind: productAttribute, product_name: draft\.product_name, product_code: draft\.product_code \}\);/);
  assert.match(pageSource, /!virtualInventoryProduct \? \(/);
  assert.match(pageSource, /RG\/SET 품목은 부모 재고를 직접 등록하지 않습니다/);
});

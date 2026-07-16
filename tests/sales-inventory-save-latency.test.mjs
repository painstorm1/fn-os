import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const source = readFileSync(new URL("../src/lib/sales-inventory.ts", import.meta.url), "utf8");

function section(start, end) {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex);
  assert.notEqual(startIndex, -1, `missing section: ${start}`);
  assert.notEqual(endIndex, -1, `missing section end: ${end}`);
  return source.slice(startIndex, endIndex);
}

test("F4 imports bound independent reads and skip resolved reference lookups", () => {
  const duplicateLookup = section("async function existingSourceRefs(", "async function findProduct(");
  assert.match(duplicateLookup, /const batchSize = 12;/);
  assert.match(duplicateLookup, /await Promise\.all\(chunks\.slice\(index, index \+ batchSize\)\.map/);

  const bomValidation = section("async function validateVirtualInventoryBomRows(", "async function updateCurrentInventory(");
  assert.match(bomValidation, /const batchSize = 12;/);
  assert.match(bomValidation, /await Promise\.all\(rows\.slice\(startIndex, startIndex \+ batchSize\)\.map/);
  assert.match(bomValidation, /const index = startIndex \+ offset;/);
  assert.match(bomValidation, /errors\.push\(\.\.\.batchErrors\.filter\(Boolean\)\);/);
  assert.doesNotMatch(bomValidation, /for \(let index = 0; index < rows\.length; index \+= 1\)/);

  const referenceValidation = section("async function validateEntryReferences(", "function blockedImportResult(");
  assert.match(referenceValidation, /next\.size_des = text\(next\.size_des \|\| product\.size_des\);/);

  const bomExpansion = section("async function expandBomInventoryRows(", "async function validateVirtualInventoryBomRows(");
  assert.match(bomExpansion, /size_des: text\(component\?\.size_des \|\| item\.size_des\),/);

  const currentUpdate = section("async function updateCurrentInventory(", "function inventoryCurrentGroupKey(");
  assert.match(currentUpdate, /const hasResolvedProduct = text\(row\.product_id\)/);
  assert.match(currentUpdate, /&& text\(row\.size_des\);/);
  assert.match(currentUpdate, /const hasResolvedWarehouse = text\(row\.warehouse_id\)/);
  assert.match(currentUpdate, /&& text\(row\.wh_name \|\| row\.warehouse_name\);/);
  assert.match(currentUpdate, /const \[product, warehouse\] = await Promise\.all\(\[/);
  assert.match(currentUpdate, /hasResolvedProduct \? null : findProduct\(row\)/);
  assert.match(currentUpdate, /hasResolvedWarehouse \? null : findWarehouse\(row\)/);
  assert.match(currentUpdate, /wh_name: text\(row\.wh_name \|\| row\.warehouse_name\) \|\| warehouseName\(warehouse\) \|\| text\(current\?\.wh_name\)/);
  assert.match(currentUpdate, /size_des: text\(row\.size_des \|\| product\?\.size_des \|\| current\?\.size_des\)/);
});

test("inventory movement history is still written before current stock changes", () => {
  const movementWrite = section("async function writeInventoryMovements(", "function deletedEntryRefValues(");
  const movementInsert = movementWrite.indexOf('await insertRowsWithSchemaFallback("inventory_movements", movementRows)');
  const currentUpdate = movementWrite.indexOf("await updateCurrentInventoryForMovements(movementPairs)");
  assert.notEqual(movementInsert, -1);
  assert.notEqual(currentUpdate, -1);
  assert.ok(movementInsert < currentUpdate);
});

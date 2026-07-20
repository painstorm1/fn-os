export type SalesShipmentProgressRow = {
  rowNumber: number;
  sourceIndex: number;
  productName: unknown;
  quantity: unknown;
  directShippingPartner?: unknown;
};

export type SalesShipmentItem = {
  productName: string;
  quantity: number;
  direct: boolean;
};

export type SalesShipmentSlot = SalesShipmentItem | { separator: true } | null;

export type SalesShipmentPage = {
  left: SalesShipmentSlot[];
  right: SalesShipmentSlot[];
};

export type SalesShipmentListResult =
  | { ok: false; invalidRowNumbers: number[]; items: []; format: null; pages: [] }
  | {
      ok: true;
      invalidRowNumbers: [];
      items: SalesShipmentItem[];
      format: "A5" | "A4";
      pages: SalesShipmentPage[];
    };

export type DirectShippingSourceIndexes = {
  JB?: number[];
  케이모아?: number[];
};

const A5_PRODUCT_LIMIT = 30;
const A5_GRID_ROWS = 17;
const A4_COLUMN_ROWS = 48;

function normalizedProductName(value: unknown) {
  return String(value ?? "").trim().replace(/\s+/g, " ");
}

function numericQuantity(value: unknown) {
  if (typeof value === "number") return Number.isFinite(value) ? value : Number.NaN;
  const text = String(value ?? "").trim();
  if (!text) return Number.NaN;
  return Number(text.replace(/,/g, ""));
}

function sortedItems(items: Iterable<SalesShipmentItem>) {
  return Array.from(items).sort((left, right) => left.productName.localeCompare(
    right.productName,
    "ko-KR",
    { numeric: true, sensitivity: "base" },
  ));
}

function fixedSlots(slots: SalesShipmentSlot[], count: number) {
  return [...slots, ...Array<SalesShipmentSlot>(Math.max(0, count - slots.length)).fill(null)];
}

function anchoredShipmentSlots(
  generalItems: SalesShipmentItem[],
  directItems: SalesShipmentItem[],
  pageCapacity: number,
) {
  const separatorCount = generalItems.length && directItems.length ? 1 : 0;
  const requiredSlots = generalItems.length + directItems.length + separatorCount;
  const pageCount = Math.max(1, Math.ceil(requiredSlots / pageCapacity));
  const slots = Array<SalesShipmentSlot>(pageCount * pageCapacity).fill(null);
  generalItems.forEach((item, index) => { slots[index] = item; });
  const directStart = slots.length - directItems.length;
  if (separatorCount) slots[directStart - 1] = { separator: true };
  directItems.forEach((item, index) => { slots[directStart + index] = item; });
  return slots;
}

export function buildSalesShipmentList(
  rows: SalesShipmentProgressRow[],
  directShippingSourceIndexes: DirectShippingSourceIndexes = {},
): SalesShipmentListResult {
  const directIndexes = new Set([
    ...(directShippingSourceIndexes.JB || []),
    ...(directShippingSourceIndexes.케이모아 || []),
  ]);
  const invalidRowNumbers: number[] = [];
  const general = new Map<string, SalesShipmentItem>();
  const direct = new Map<string, SalesShipmentItem>();

  rows.forEach((row) => {
    const productName = normalizedProductName(row.productName);
    const quantity = numericQuantity(row.quantity);
    if (!productName || !Number.isFinite(quantity) || quantity <= 0) {
      invalidRowNumbers.push(row.rowNumber);
      return;
    }
    const partner = String(row.directShippingPartner ?? "").trim();
    const isDirect = partner === "JB" || partner === "케이모아" || directIndexes.has(row.sourceIndex);
    const target = isDirect ? direct : general;
    const current = target.get(productName);
    if (current) current.quantity += quantity;
    else target.set(productName, { productName, quantity, direct: isDirect });
  });

  if (invalidRowNumbers.length) {
    return { ok: false, invalidRowNumbers, items: [], format: null, pages: [] };
  }

  const generalItems = sortedItems(general.values());
  const directItems = sortedItems(direct.values());
  const items = [...generalItems, ...directItems];
  const format = items.length <= A5_PRODUCT_LIMIT ? "A5" : "A4";
  const pageCapacity = format === "A5" ? A5_GRID_ROWS : A4_COLUMN_ROWS * 2;
  const slots = anchoredShipmentSlots(generalItems, directItems, pageCapacity);
  const pages: SalesShipmentPage[] = [];

  if (format === "A5") {
    for (let offset = 0; offset < slots.length; offset += A5_GRID_ROWS) {
      pages.push({
        left: fixedSlots(slots.slice(offset, offset + A5_GRID_ROWS), A5_GRID_ROWS),
        right: [],
      });
    }
  } else {
    for (let offset = 0; offset < slots.length; offset += A4_COLUMN_ROWS * 2) {
      const pageSlots = slots.slice(offset, offset + A4_COLUMN_ROWS * 2);
      pages.push({
        left: fixedSlots(pageSlots.slice(0, A4_COLUMN_ROWS), A4_COLUMN_ROWS),
        right: fixedSlots(pageSlots.slice(A4_COLUMN_ROWS), A4_COLUMN_ROWS),
      });
    }
  }

  return { ok: true, invalidRowNumbers: [], items, format, pages };
}

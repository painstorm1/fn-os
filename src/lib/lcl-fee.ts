import { readFileSync } from "node:fs";
import path from "node:path";
import * as XLSX from "xlsx";

type TariffRow = {
  cbm: number;
  fee: number;
};

type TariffFamily = "LCL(월수금)" | "LCL(화목일)";

const WORKBOOK_PATH = path.join(process.cwd(), "data", "타배_배송비용.xlsx");
const METHOD_SHEETS: Record<string, TariffFamily> = {
  "LCL(월수금)": "LCL(월수금)",
  "LCL(화목일)": "LCL(화목일)",
  "LCL(분할)": "LCL(월수금)",
  "LCL(전체)": "LCL(화목일)",
};

let tariffRowsCache: Record<TariffFamily, TariffRow[]> | null = null;

export function roundHalfEven(value: number, decimalPlaces = 0) {
  const factor = 10 ** decimalPlaces;
  const scaled = value * factor;
  const lower = Math.floor(scaled);
  const fraction = scaled - lower;
  const tolerance = Number.EPSILON * Math.max(1, Math.abs(scaled)) * 4;
  const rounded = Math.abs(fraction - 0.5) <= tolerance
    ? (lower % 2 === 0 ? lower : lower + 1)
    : Math.round(scaled);
  return rounded / factor;
}

function parseCbmLabel(value: unknown) {
  if (value === null || value === undefined) return null;
  const parsed = Number(String(value).toLowerCase().replace("cbm", "").trim());
  return Number.isFinite(parsed) ? roundHalfEven(parsed, 1) : null;
}

function loadTariffRows() {
  if (tariffRowsCache) return tariffRowsCache;

  const workbook = XLSX.read(readFileSync(WORKBOOK_PATH), { type: "buffer" });
  const readSheet = (sheetName: TariffFamily) => {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) throw new Error(`LCL 요율표 시트를 찾을 수 없습니다: ${sheetName}`);
    const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: true, defval: null });
    return rows.slice(1).flatMap((row) => {
      const cbm = parseCbmLabel(row[0]);
      if (cbm === null || row[1] === null || row[1] === undefined) return [];
      const fee = Number(row[1]);
      return Number.isFinite(fee) ? [{ cbm, fee }] : [];
    });
  };

  tariffRowsCache = {
    "LCL(월수금)": readSheet("LCL(월수금)"),
    "LCL(화목일)": readSheet("LCL(화목일)"),
  };
  return tariffRowsCache;
}

function lookupShippingFee(method: string, cbm: number) {
  if (cbm <= 0) return 0;
  const family = METHOD_SHEETS[method] || "LCL(월수금)";
  const target = Math.max(roundHalfEven(cbm + 0.049999, 1), 0.5);
  const row = loadTariffRows()[family].find((candidate) => candidate.cbm >= target);
  return row?.fee ?? 0;
}

export function calculateLclFee(method: string, cbm: number, usdRate: number) {
  const normalizedCbm = Number.isFinite(cbm) ? cbm : 0;
  const normalizedUsdRate = Number.isFinite(usdRate) && usdRate > 0 ? usdRate : 1500;
  const cwcUsd = normalizedCbm > 0
    ? Math.max(10, roundHalfEven(normalizedCbm * 10 + 0.499999) * 2)
    : 0;

  return {
    method,
    cbm: normalizedCbm,
    shipping_fee: roundHalfEven(lookupShippingFee(method, normalizedCbm)),
    origin_certificate: 33000,
    bl_charge: 22000,
    forwarder_hc: 11000,
    cwc_usd: cwcUsd,
    usd_rate: normalizedUsdRate,
    cwc_krw: roundHalfEven(cwcUsd * normalizedUsdRate),
  };
}

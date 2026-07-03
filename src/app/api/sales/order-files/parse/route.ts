import { NextResponse } from "next/server";
import officeCrypto from "officecrypto-tool";
import * as XLSX from "xlsx";

export const runtime = "nodejs";

type SheetName = "송장출력용" | "FN송장입력" | "FN판매입력";
type OrderSource = "legacy" | "esm" | "todayhouse" | "toss" | "ezwell" | "unknown";
type ParsedInvoiceRow = {
  trackingNo: string;
  recipient: string;
  phone: string;
  address: string;
  productCode: string;
  fileName: string;
  sourceRow: number;
};

const ORDER_FILE_PASSWORD = process.env.ORDER_FILE_PASSWORD || "";

const headers: Record<SheetName, string[]> = {
  송장출력용: ["쇼핑몰코드", "송장번호", "수취인", "수취인연락처1", "수취인연락처2", "우편번호", "주소", "주문옵션", "수량", "배송요청사항", "정산예정금액"],
  FN송장입력: ["쇼핑몰코드", "주문번호", "묶음주문번호", "배송방법코드", "송장번호"],
  FN판매입력: ["일자", "거래처코드", "거래처명", "출하창고", "VAT 포함/별도", "품목코드", "품목명", "수량", "단가", "세액", "공급가액", "합계금액", "메모"],
};

function clean(value: unknown) {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

function cleanOrderId(value: unknown) {
  const raw = clean(value);
  if (/^\d+\.0$/.test(raw)) return raw.replace(/\.0$/, "");
  return raw;
}

function cleanContact(value: unknown) {
  const text = clean(value);
  return text === "-" || text === "--" ? "" : text;
}

function normalizeContacts(contact1: unknown, contact2: unknown) {
  const first = cleanContact(contact1);
  const second = cleanContact(contact2);
  const fallback = first || second;
  return {
    contact1: first || fallback,
    contact2: second || fallback,
  };
}

type OrderSortToken = { raw: string; rank: number; numberValue: number | null };

function orderSortTokenize(value: string): OrderSortToken[] {
  const cleaned = String(value || "")
    .replace(/\[[^\]]+\]/g, "")
    .trim()
    .toLowerCase();
  const matches = cleaned.match(/[A-Za-z]+|\d+(?:\.\d+)?|[\uAC00-\uD7A3]+|[^A-Za-z0-9\uAC00-\uD7A3]+/g) || [];
  return matches
    .map((raw) => {
      const numberValue = /^\d/.test(raw) ? Number(raw) : null;
      const rank = numberValue !== null && Number.isFinite(numberValue)
        ? 0
        : /^[A-Za-z]+$/.test(raw)
          ? 1
          : /^[\uAC00-\uD7A3]+$/.test(raw)
            ? 2
            : 3;
      return { raw, rank, numberValue };
    })
    .filter((token) => token.raw.trim() || token.rank !== 3);
}

function compareOrderText(a: string, b: string) {
  const left = clean(a);
  const right = clean(b);
  if (!left && !right) return 0;
  if (!left) return 1;
  if (!right) return -1;

  const leftTokens = orderSortTokenize(left);
  const rightTokens = orderSortTokenize(right);
  const length = Math.max(leftTokens.length, rightTokens.length);

  for (let index = 0; index < length; index += 1) {
    const leftToken = leftTokens[index];
    const rightToken = rightTokens[index];
    if (!leftToken) return -1;
    if (!rightToken) return 1;

    if (leftToken.rank !== rightToken.rank) return leftToken.rank - rightToken.rank;

    if (leftToken.numberValue !== null && rightToken.numberValue !== null) {
      const diff = leftToken.numberValue - rightToken.numberValue;
      if (diff !== 0) return diff;
      continue;
    }

    const locale = leftToken.rank === 0 ? "en" : "ko";
    const diff = leftToken.raw.localeCompare(rightToken.raw, locale, { numeric: true, sensitivity: "base" });
    if (diff !== 0) return diff;
  }

  return left.localeCompare(right, "ko", { numeric: true, sensitivity: "base" });
}

function parseNumber(value: unknown) {
  const next = Number(clean(value).replace(/,/g, ""));
  return Number.isFinite(next) ? next : 0;
}

function comma(value: unknown) {
  const number = parseNumber(value);
  if (!number) return clean(value);
  return Math.round(number).toLocaleString("ko-KR");
}

function dateDigits(value: unknown) {
  const raw = clean(value);
  const digits = raw.replace(/\D/g, "");
  if (digits.length >= 8) return digits.slice(0, 8);
  return raw;
}

function monthDay(value: unknown) {
  const digits = dateDigits(value);
  if (digits.length >= 8) return `${digits.slice(4, 6)}${digits.slice(6, 8)}`;
  const now = new Date();
  return `${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}`;
}

function todayMonthDay() {
  const now = new Date();
  return `${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}`;
}

function pick(row: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = row[key];
    if (value !== undefined && value !== null && clean(value) !== "") return value;
  }
  return "";
}

function hasKeys(row: Record<string, unknown>, keys: string[]) {
  return keys.some((key) => Object.prototype.hasOwnProperty.call(row, key));
}

function asRow(row: Record<string, unknown>, sheet: SheetName) {
  if (sheet === "FN판매입력") {
    return [
      clean(pick(row, ["일자", "일자*"])),
      clean(pick(row, ["거래처코드"])),
      clean(pick(row, ["거래처명", "거래처명*"])),
      clean(pick(row, ["출하창고", "출하창고*"])) || "100",
      clean(pick(row, ["VAT 포함/별도"])) || "포함",
      clean(pick(row, ["품목코드", "품목코드*"])),
      clean(pick(row, ["품목명", "품목명*"])),
      clean(pick(row, ["수량", "수량*"])),
      clean(pick(row, ["단가", "단가(vat포함)"])),
      clean(pick(row, ["세액"])),
      clean(pick(row, ["공급가액"])),
      clean(pick(row, ["합계금액", "공급가액"])),
      clean(pick(row, ["메모", "적요"])),
    ];
  }
  return headers[sheet].map((header) => clean(row[header]));
}

function stripPrefixTag(value: string) {
  return value.replace(/^\[[^\]]+\]\s*/, "").trim();
}

const orderOptionReplacements: Array<[string, string]> = [
  ["제품선택: ", ""],
  ["제품선택:", ""],
  [" / 선글라스 색상: ", "_"],
  [" / 사이즈: ", "_"],
  [" / 색상: : ", "_"],
  ["축구양말 / 모델: ", ""],
  [" / 색상 사이즈: ", "_"],
  [" / 색상: ", "_"],
  ["길이:", "펀링크 180도 회전케이블"],
  [" / 컬러: ", "_"],
  ["TF인조잔디용 / 모델: ", ""],
  ["앵클&신가드 / 모델: ", ""],
  ["컬러: ", ""],
  ["/ 모델 사이즈: ", ""],
  ["충전기 어댑터: ", ""],
  ["신가드&보호용품: ", ""],
  ["변환젠더: ", ""],
  [",색상:", "_"],
  [" / 구성: ", "_"],
  ["TF인조잔디용:", ""],
  [":", "_"],
  ["강력한 패딩 얼룩 제거 물티슈 얼룩 제거제 티슈 휴대용 8매, ", "얼룩 제거제 티슈 휴대용 8매_"],
  ["Type C to USB A 3.0 C타입 이어폰 변환 젠더 USB아답터 ", "펀링크 USB3.0아답터 젠더_"],
  ["안전인증 정식수입 휴대용 얼룩 제거제 키링 스테인 리무버 12ml 제품선택;휴대용 얼룩 제거제 키링", "휴대용 얼룩 제거제 키링"],
  ["펀링크 C to C타입 180도 회전형 초고속 충전 케이블 PD60W USB-A젠더 포함 1개, ", "펀링크 C to C 케이블_"],
];

function normalizeOrderOptionText(value: string) {
  let next = stripPrefixTag(value);
  for (const [from, to] of orderOptionReplacements) {
    next = next.split(from).join(to);
  }
  return next.replace(/_+/g, "_").replace(/\s+_/g, "_").replace(/_\s+/g, "_").trim();
}

function classifyOrderFileName(fileName: string): OrderSource {
  const name = fileName.toLowerCase();
  if (/esk\d*m/i.test(fileName) || name.includes("legacy-order")) return "legacy";
  if (fileName.includes("신규주문") || fileName.includes("ESM") || fileName.includes("지마켓") || fileName.includes("G마켓") || fileName.includes("옥션")) return "esm";
  if (fileName.includes("주문배송 내역") || fileName.includes("오늘의집") || fileName.includes("오늘의 집")) return "todayhouse";
  if (fileName.includes("주문배송관리-상품준비중") || fileName.includes("토스")) return "toss";
  if (fileName.includes("배송목록") || fileName.includes("현대이지웰") || fileName.includes("이지웰")) return "ezwell";
  return "unknown";
}

function mallAlias(mallName: string, mallCode: string, forcedAlias = "") {
  if (forcedAlias) return forcedAlias;
  const name = mallName.toLowerCase();
  if (name.includes("펀앤파인")) return "FF";
  if (name.includes("에프엔") || name.includes("fn")) return "FN";
  if (name.includes("쿠팡")) return "C";
  if (name.includes("esm") || name.includes("g마켓") || name.includes("지마켓") || name.includes("gmarket") || name.includes("옥션") || name.includes("auction")) return "E";
  if (name.includes("롯데")) return "L";
  if (name.includes("신세계")) return "S";
  if (name.includes("11번가") || name.includes("11st")) return "11";
  if (name.includes("토스")) return "T";
  if (name.includes("현대") || name.includes("이지웰")) return "Z";
  if (name.includes("오늘의집") || name.includes("오늘")) return "O";
  const code = clean(mallCode).toUpperCase();
  const codeAlias: Record<string, string> = {
    "00001": "FN",
    "00002": "FF",
    "00003": "11",
    "00004": "C",
    "2208183676": "E",
    "00007": "K",
    "00008": "S",
    "00009": "L",
  };
  if (codeAlias[code]) return codeAlias[code];
  if (code === "L" || code.includes("LOTTE")) return "L";
  if (code === "S" || code.includes("SHINSEGAE")) return "S";
  return clean(mallCode) || "FN";
}

function shouldIncludeInvoiceRow(alias: string) {
  return !["O", "T", "Z", "L", "S"].includes(clean(alias).toUpperCase());
}

function makeOrderOption(row: Record<string, unknown>) {
  const qty = Math.max(1, Math.round(parseNumber(pick(row, ["수량", "M 수량"]))) || 1);
  const name = normalizeOrderOptionText(clean(pick(row, ["품목명(ERP)", "품목명", "주문옵션", "쇼핑몰상품명"])));
  return qty > 1 ? `${name}-★${qty}개` : name;
}

function isValidDownRow(row: Record<string, unknown>) {
  const recipient = clean(pick(row, ["수취인"]));
  const orderNo = clean(pick(row, ["주문번호", "묶음주문번호"]));
  const option = clean(pick(row, ["품목명(ERP)", "품목명", "주문옵션", "쇼핑몰상품명"]));
  if (["수정 불가", "수정 가능"].includes(orderNo) || ["수정 불가", "수정 가능"].includes(recipient)) return false;
  return Boolean(recipient && orderNo && option);
}

function buildFromDownRows(rows: Record<string, unknown>[]) {
  const counters = new Map<string, number>();
  const shipping: Array<{ sortKey: string; row: string[] }> = [];
  const invoice: string[][] = [];
  const sale: string[][] = [];

  for (const source of rows) {
    if (!isValidDownRow(source)) continue;

    const mallName = clean(pick(source, ["쇼핑몰명", "거래처명"]));
    const mallCode = clean(pick(source, ["쇼핑몰코드"]));
    const date = pick(source, ["수집일자", "일자"]);
    const alias = mallAlias(mallName, mallCode, clean(source.__alias));
    const countKey = `${todayMonthDay()}-${alias}`;
    const next = (counters.get(countKey) || 0) + 1;
    counters.set(countKey, next);
    const generatedMallCode = mallCode || `${countKey}-${String(next).padStart(3, "0")}`;

    const qty = Math.max(1, parseNumber(pick(source, ["수량", "M 수량"])) || 1);
    const rawAmount = parseNumber(pick(source, ["정산예정금액", "공급가액", "주문금액", "실주문금액", "판매가 * 수량"]));
    const isSettlementDeducted =
      ["C", "T", "S", "L", "K"].includes(alias) ||
      mallName.includes("쿠팡") ||
      mallName.includes("토스") ||
      mallName.includes("신세계") ||
      mallName.includes("롯데") ||
      mallName.includes("카카오") ||
      mallName.includes("톡딜");
    const amount = isSettlementDeducted ? rawAmount * 0.88 : rawAmount;
    const unit = qty ? amount / qty : amount;
    const { contact1, contact2 } = normalizeContacts(pick(source, ["수취인연락처1"]), pick(source, ["수취인연락처2"]));
    const option = makeOrderOption(source);

    shipping.push({
      sortKey: `${option}\u0000${countKey}-${String(next).padStart(3, "0")}`,
      row: [
        generatedMallCode,
        clean(pick(source, ["송장번호"])),
        clean(pick(source, ["수취인"])),
        contact1,
        contact2,
        clean(pick(source, ["우편번호"])),
        clean(pick(source, ["주소"])),
        option,
        "1",
        clean(pick(source, ["배송요청사항"])),
        comma(amount),
      ],
    });

    if (shouldIncludeInvoiceRow(alias)) {
      invoice.push([
        generatedMallCode,
        clean(pick(source, ["주문번호"])),
        clean(pick(source, ["묶음주문번호"])),
        clean(pick(source, ["배송방법코드"])),
        clean(pick(source, ["송장번호"])),
      ]);
    }

    const productCode = clean(pick(source, ["품목코드(ERP)", "품목코드"]));
    sale.push([
      dateDigits(date),
      "",
      "",
      mallName,
      "100",
      "포함",
      productCode,
      productCode ? clean(pick(source, ["품목명(ERP)", "품목명"])) : option,
      clean(pick(source, ["수량"])) || "1",
      unit ? comma(unit) : "",
      "",
      amount ? comma(amount) : "",
      amount ? comma(amount) : "",
      "",
    ]);
  }

  return {
    shipping: shipping
      .sort((a, b) => compareOrderText(a.sortKey, b.sortKey))
      .map((item) => item.row),
    invoice,
    sale: sale.sort((a, b) => {
      const aMissingCode = clean(a[9]) ? 1 : 0;
      const bMissingCode = clean(b[9]) ? 1 : 0;
      if (aMissingCode !== bMissingCode) return aMissingCode - bMissingCode;
      return 0;
    }),
  };
}

function joinText(...values: unknown[]) {
  return values.map(clean).filter(Boolean).join(" ").trim();
}

function toCanonicalRows(rows: Record<string, unknown>[], source: OrderSource) {
  if (source === "legacy" || source === "unknown") return rows;

  return rows.map((row) => {
    if (source === "esm") {
      const sellerCode = cleanOrderId(pick(row, ["판매자관리코드", "판매자상세관리코드"]));
      return {
        __alias: "E",
        수집일자: pick(row, ["결제일", "주문일자(결제확인전)"]),
        쇼핑몰명: "ESM이에스엠",
        쇼핑몰코드: "",
        주문번호: cleanOrderId(pick(row, ["주문번호"])),
        묶음주문번호: cleanOrderId(pick(row, ["장바구니번호(결제번호)", "배송번호", "주문번호"])),
        배송방법코드: "CJGLS",
        송장번호: pick(row, ["송장번호", "운송장번호"]),
        수취인: pick(row, ["수령인명", "구매자명"]),
        수취인연락처1: pick(row, ["수령인 휴대폰", "수령인 전화번호", "구매자 휴대폰"]),
        수취인연락처2: pick(row, ["수령인 전화번호", "수령인 휴대폰", "구매자 전화번호"]),
        우편번호: pick(row, ["우편번호"]),
        주소: pick(row, ["주소"]),
        주문옵션: joinText(pick(row, ["상품명"]), pick(row, ["옵션"])),
        수량: pick(row, ["수량"]),
        배송요청사항: pick(row, ["배송시 요구사항"]),
        정산예정금액: pick(row, ["정산예정금액", "판매금액", "판매단가"]),
        품목코드: sellerCode,
        품목명: pick(row, ["상품명"]),
      };
    }

    if (source === "todayhouse") {
      return {
        __alias: "O",
        수집일자: pick(row, ["주문결제완료일", "출고예정일"]),
        쇼핑몰명: "오늘의 집",
        주문번호: pick(row, ["주문번호"]),
        묶음주문번호: pick(row, ["묶음배송그룹", "주문번호"]),
        배송방법코드: pick(row, ["배송방법"]),
        송장번호: pick(row, ["운송장번호"]),
        수취인: pick(row, ["수취인명"]),
        수취인연락처1: pick(row, ["수취인 연락처"]),
        수취인연락처2: pick(row, ["수취인 연락처"]),
        우편번호: pick(row, ["수취인 우편번호"]),
        주소: joinText(pick(row, ["수취인 주소"]), pick(row, ["수취인 주소상세"])),
        주문옵션: joinText(pick(row, ["상품명"]), pick(row, ["옵션명"])),
        수량: pick(row, ["수량"]),
        배송요청사항: pick(row, ["배송메모", "주문메모"]),
        정산예정금액: pick(row, ["정산예정금액", "판매가*수량 + 조립비 + 배송비", "판매가 * 수량"]),
      };
    }

    if (source === "toss") {
      return {
        __alias: "T",
        수집일자: pick(row, ["주문일시", "발송기한"]),
        쇼핑몰명: "토스",
        주문번호: pick(row, ["주문번호"]),
        묶음주문번호: pick(row, ["배송비 묶음 번호", "주문번호"]),
        배송방법코드: pick(row, ["택배사"]),
        송장번호: pick(row, ["송장번호"]),
        수취인: pick(row, ["수령인명", "구매자명"]),
        수취인연락처1: pick(row, ["수령인 연락처", "구매자 연락처"]),
        수취인연락처2: pick(row, ["수령인 연락처", "구매자 연락처"]),
        우편번호: pick(row, ["우편번호"]),
        주소: pick(row, ["배송지"]),
        주문옵션: joinText(pick(row, ["상품명"]), pick(row, ["옵션명"])),
        수량: pick(row, ["주문건수"]),
        배송요청사항: pick(row, ["주문요청사항"]),
        정산예정금액: pick(row, ["주문금액"]),
      };
    }

    return {
      __alias: "Z",
      수집일자: pick(row, ["주문일시", "주문확인일시"]),
      쇼핑몰명: "현대이지웰",
      주문번호: pick(row, ["주문번호"]),
      묶음주문번호: pick(row, ["장바구니 번호", "주문번호"]),
      배송방법코드: pick(row, ["택배사"]),
      송장번호: pick(row, ["운송장번호"]),
      수취인: pick(row, ["수령자명", "주문자명"]),
      수취인연락처1: pick(row, ["수령자 휴대폰번호", "주문자 휴대폰번호"]),
      수취인연락처2: pick(row, ["수령자 휴대폰번호", "주문자 휴대폰번호"]),
      우편번호: pick(row, ["우편번호"]),
      주소: pick(row, ["주소"]),
      주문옵션: joinText(pick(row, ["상품명"]), pick(row, ["옵션"])),
      수량: pick(row, ["주문수량", "배송수량"]),
      배송요청사항: pick(row, ["배송메시지(요청사항)"]),
      정산예정금액: pick(row, ["매입가", "실주문금액", "판매가격"]),
    };
  });
}

const knownHeaderNames = [
  ...headers.송장출력용,
  ...headers.FN송장입력,
  ...headers.FN판매입력,
  ...headers.FN판매입력.map((header) => `${header}*`),
  "담당자",
  "거래유형",
  "통화",
  "환율",
  "규격",
  "단가(vat포함)",
  "외화금액",
  "적요",
  "생산전표생성",
  "결과",
  "수집처",
  "수집일자",
  "품목코드(ERP)",
  "쇼핑몰상품코드",
  "품목명(ERP)",
  "쇼핑몰품목key",
  "쇼핑몰명",
  "주문상태",
  "상태별처리기능",
  "수령자명",
  "수령자 휴대폰번호",
  "배송메시지(요청사항)",
  "주문일시",
  "주문상품번호",
  "상품명",
  "옵션명",
  "주문건수",
  "수령인명",
  "배송지",
  "주문요청사항",
  "주문금액",
  "수취인명",
  "수취인 연락처",
  "수취인 우편번호",
  "수취인 주소",
  "수취인 주소상세",
  "배송메모",
  "판매아이디",
  "주문일자(결제확인전)",
  "구매자명",
  "상품번호",
  "수령인명",
  "판매자관리코드",
  "수령인 휴대폰",
  "배송시 요구사항",
  "배송번호",
  "장바구니번호(결제번호)",
  "결제일",
  "정산예정금액",
];

function rowsFromWorksheet(sheet: XLSX.WorkSheet) {
  const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, { defval: "", raw: false, header: 1 });
  const headerIndex = matrix.findIndex((row) => {
    const values = row.map((cell) => clean(cell));
    return values.filter((cell) => knownHeaderNames.includes(cell)).length >= 3;
  });
  if (headerIndex < 0) {
    return XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "", raw: false });
  }
  const headerRow = matrix[headerIndex].map((cell) => clean(cell));
  return matrix.slice(headerIndex + 1).map((row) => {
    const next: Record<string, unknown> = {};
    headerRow.forEach((header, index) => {
      if (header) next[header] = row[index] ?? "";
    });
    return next;
  });
}

function parseInvoiceRowsFromWorksheet(sheet: XLSX.WorkSheet, fileName: string) {
  const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, { defval: "", raw: false, header: 1 });
  const rows: ParsedInvoiceRow[] = [];
  const seen = new Set<string>();
  matrix.forEach((row, rowIndex) => {
    const trackingNo = clean(row[7]);
    const recipient = clean(row[20]);
    const phone = clean(row[21]);
    const address = clean(row[23]);
    const productCode = clean(row[24]);
    if (!trackingNo || !recipient || !phone || !address) return;
    if (/송장|운송장|받는분|수취인/i.test(`${trackingNo} ${recipient}`)) return;
    const key = [trackingNo, recipient, phone, address, productCode].map((value) => value.replace(/\s+/g, "").toLowerCase()).join("|");
    if (seen.has(key)) return;
    seen.add(key);
    rows.push({ trackingNo, recipient, phone, address, productCode, fileName, sourceRow: rowIndex + 1 });
  });
  return rows;
}

function isWorkbookPasswordError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return /password|encrypted|encryption|protected/i.test(message);
}

async function decryptWorkbookBuffer(buffer: Buffer, password: string) {
  if (!password) {
    throw new Error("암호화된 엑셀입니다. ORDER_FILE_PASSWORD 환경변수를 설정해 주세요.");
  }

  try {
    return await officeCrypto.decrypt(buffer, { password });
  } catch {
    throw new Error("암호화된 엑셀을 열지 못했습니다. 엑셀 비밀번호를 확인해 주세요.");
  }
}

async function readWorkbook(buffer: Buffer, password: string) {
  const read = (input: Buffer) => XLSX.read(input, {
    type: "buffer",
    cellDates: false,
  });

  if (officeCrypto.isEncrypted(buffer)) {
    return read(await decryptWorkbookBuffer(buffer, password));
  }

  try {
    return read(buffer);
  } catch (error) {
    if (!isWorkbookPasswordError(error)) throw error;
    return read(await decryptWorkbookBuffer(buffer, password));
  }
}

export async function POST(request: Request) {
  try {
    const form = await request.formData();
    const files = form.getAll("files").filter((item): item is File => item instanceof File);
    const kind = clean(form.get("kind"));
    const workbookPassword = clean(form.get("order_file_password")) || ORDER_FILE_PASSWORD;
    if (!files.length) {
      return NextResponse.json({ ok: false, error: "업로드할 파일이 없습니다." }, { status: 400 });
    }

    if (kind === "invoices") {
      const invoiceRows: ParsedInvoiceRow[] = [];
      const parsedFiles: string[] = [];
      for (const file of files) {
        const buffer = Buffer.from(await file.arrayBuffer());
        const workbook = await readWorkbook(buffer, workbookPassword);
        parsedFiles.push(file.name);
        for (const sheetName of workbook.SheetNames) {
          invoiceRows.push(...parseInvoiceRowsFromWorksheet(workbook.Sheets[sheetName], file.name));
        }
      }
      return NextResponse.json({ ok: true, files: parsedFiles, invoiceRows });
    }

    const result: Record<SheetName, string[][]> = {
      송장출력용: [],
      FN송장입력: [],
      FN판매입력: [],
    };
    const downRows: Record<string, unknown>[] = [];
    const parsedFiles: string[] = [];

    for (const file of files) {
      const source = classifyOrderFileName(file.name);
      const buffer = Buffer.from(await file.arrayBuffer());
      const workbook = await readWorkbook(buffer, workbookPassword);
      parsedFiles.push(file.name);

      for (const sheetName of workbook.SheetNames) {
        const worksheet = workbook.Sheets[sheetName];
        const rows = rowsFromWorksheet(worksheet).filter((row) => Object.values(row).some((value) => clean(value)));
        if (!rows.length) continue;

        const detectedSource = source === "unknown" && rows.some((row) => hasKeys(row, ["판매아이디", "배송번호", "장바구니번호(결제번호)"])) ? "esm" : source;
        if (detectedSource !== "unknown" && detectedSource !== "legacy") {
          downRows.push(...toCanonicalRows(rows, detectedSource));
          continue;
        }

        const isDownData = sheetName === "다운_데이터" || sheetName === "주문관리진행단계" || rows.some((row) => hasKeys(row, ["수집처", "품목코드(ERP)", "쇼핑몰상품코드", "쇼핑몰품목key"]));
        if (isDownData) {
          downRows.push(...rows);
          continue;
        }

        if (sheetName === "송장출력용" || rows.some((row) => hasKeys(row, headers.송장출력용))) {
          result.송장출력용.push(...rows.map((row) => asRow(row, "송장출력용")).filter((row) => row.some(Boolean)));
        }
        if (sheetName === "FN송장입력" || rows.some((row) => hasKeys(row, headers.FN송장입력))) {
          result.FN송장입력.push(...rows.map((row) => asRow(row, "FN송장입력")).filter((row) => row.some(Boolean)));
        }
        if (sheetName === "1_판매입력" || sheetName === "FN판매입력" || rows.some((row) => hasKeys(row, headers.FN판매입력))) {
          result.FN판매입력.push(...rows.map((row) => asRow(row, "FN판매입력")).filter((row) => row.some(Boolean)));
        }
      }
    }

    if (downRows.length) {
      const converted = buildFromDownRows(downRows);
      result.송장출력용.push(...converted.shipping);
      result.FN송장입력.push(...converted.invoice);
      result.FN판매입력.push(...converted.sale);
    }

    return NextResponse.json({ ok: true, files: parsedFiles, sheets: result });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "엑셀 파일 파싱 실패" }, { status: 500 });
  }
}

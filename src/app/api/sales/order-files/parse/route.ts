import { NextResponse } from "next/server";
import officeCrypto from "officecrypto-tool";
import * as XLSX from "xlsx";

export const runtime = "nodejs";

type SheetName = "송장출력용" | "이카운트_송장입력" | "이카운트_판매입력";
type OrderSource = "ecount" | "todayhouse" | "toss" | "ezwell" | "unknown";

const ORDER_FILE_PASSWORD = process.env.ORDER_FILE_PASSWORD || "";

const headers: Record<SheetName, string[]> = {
  송장출력용: ["쇼핑몰코드", "수취인", "수취인연락처1", "수취인연락처2", "우편번호", "주소", "주문옵션", "수량", "배송요청사항", "정산예정금액"],
  이카운트_송장입력: ["쇼핑몰코드", "주문번호", "묶음주문번호", "배송방법코드", "송장번호"],
  이카운트_판매입력: ["일자", "순번", "거래처코드", "거래처명", "담당자", "출하창고", "거래유형", "통화", "환율", "품목코드", "품목명", "규격", "수량", "단가(vat포함)", "외화금액", "공급가액", "적요", "생산전표생성", "결과"],
};

function clean(value: unknown) {
  if (value === null || value === undefined) return "";
  return String(value).trim();
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
  return headers[sheet].map((header) => clean(row[header]));
}

function stripPrefixTag(value: string) {
  return value.replace(/^\[[^\]]+\]\s*/, "").trim();
}

function classifyOrderFileName(fileName: string): OrderSource {
  const name = fileName.toLowerCase();
  if (/esk\d*m/i.test(fileName) || name.includes("ecount") || name.includes("이카운트")) return "ecount";
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
  if (name.includes("롯데")) return "L";
  if (name.includes("신세계")) return "S";
  if (name.includes("11번가") || name.includes("11st")) return "11";
  if (name.includes("토스")) return "T";
  if (name.includes("현대") || name.includes("이지웰")) return "Z";
  if (name.includes("오늘의집") || name.includes("오늘")) return "O";
  const code = clean(mallCode).toUpperCase();
  if (code === "L" || code.includes("LOTTE")) return "L";
  if (code === "S" || code.includes("SHINSEGAE")) return "S";
  return clean(mallCode) || "FN";
}

function shouldIncludeInvoiceRow(alias: string) {
  return !["O", "T", "Z", "L", "S"].includes(clean(alias).toUpperCase());
}

function makeOrderOption(row: Record<string, unknown>) {
  const qty = Math.max(1, Math.round(parseNumber(pick(row, ["수량", "M 수량"]))) || 1);
  const name = stripPrefixTag(clean(pick(row, ["품목명(ERP)", "품목명", "주문옵션", "쇼핑몰상품명"])));
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

    const qty = Math.max(1, parseNumber(pick(source, ["수량", "M 수량"])) || 1);
    const rawAmount = parseNumber(pick(source, ["정산예정금액", "공급가액", "주문금액", "실주문금액", "판매가 * 수량"]));
    const isSettlementDeducted = alias === "C" || alias === "T" || mallName.includes("쿠팡") || mallName.includes("토스");
    const amount = isSettlementDeducted ? rawAmount * 0.88 : rawAmount;
    const unit = qty ? amount / qty : amount;
    const contact1 = clean(pick(source, ["수취인연락처1"]));
    const contact2 = clean(pick(source, ["수취인연락처2"])) || contact1;
    const option = makeOrderOption(source);

    shipping.push({
      sortKey: `${option}\u0000${countKey}-${String(next).padStart(3, "0")}`,
      row: [
        `${countKey}-A${String(next).padStart(3, "0")}`,
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
        mallCode,
        clean(pick(source, ["\uC8FC\uBB38\uBC88\uD638"])),
        clean(pick(source, ["\uBB36\uC74C\uC8FC\uBB38\uBC88\uD638"])),
        clean(pick(source, ["\uBC30\uC1A1\uBC29\uBC95\uCF54\uB4DC"])),
        clean(pick(source, ["\uC1A1\uC7A5\uBC88\uD638"])),
      ]);
    }

    sale.push([
      dateDigits(date),
      "",
      "",
      mallName,
      "",
      "100",
      "",
      "",
      "",
      clean(pick(source, ["품목코드(ERP)", "품목코드"])),
      "",
      "",
      clean(pick(source, ["수량"])) || "1",
      unit ? comma(unit) : "",
      "",
      amount ? comma(amount) : "",
      "",
      "Y",
      "",
    ]);
  }

  return {
    shipping: shipping
      .sort((a, b) => compareOrderText(a.sortKey, b.sortKey))
      .map((item) => item.row),
    invoice,
    sale,
  };
}

function joinText(...values: unknown[]) {
  return values.map(clean).filter(Boolean).join(" ").trim();
}

function toCanonicalRows(rows: Record<string, unknown>[], source: OrderSource) {
  if (source === "ecount" || source === "unknown") return rows;

  return rows.map((row) => {
    if (source === "todayhouse") {
      return {
        __alias: "O",
        수집일자: pick(row, ["주문결제완료일", "출고예정일"]),
        쇼핑몰명: "오늘의집",
        쇼핑몰코드: "O",
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
        쇼핑몰코드: "T",
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
      쇼핑몰코드: "Z",
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
  ...headers.이카운트_송장입력,
  ...headers.이카운트_판매입력,
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
    const workbookPassword = clean(form.get("order_file_password")) || ORDER_FILE_PASSWORD;
    if (!files.length) {
      return NextResponse.json({ ok: false, error: "업로드할 파일이 없습니다." }, { status: 400 });
    }

    const result: Record<SheetName, string[][]> = {
      송장출력용: [],
      이카운트_송장입력: [],
      이카운트_판매입력: [],
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

        if (source !== "unknown" && source !== "ecount") {
          downRows.push(...toCanonicalRows(rows, source));
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
        if (sheetName === "이카운트_송장입력" || rows.some((row) => hasKeys(row, headers.이카운트_송장입력))) {
          result.이카운트_송장입력.push(...rows.map((row) => asRow(row, "이카운트_송장입력")).filter((row) => row.some(Boolean)));
        }
        if (sheetName === "1_판매입력" || sheetName === "이카운트_판매입력" || sheetName === "이카운트 판매입력" || rows.some((row) => hasKeys(row, headers.이카운트_판매입력))) {
          result.이카운트_판매입력.push(...rows.map((row) => asRow(row, "이카운트_판매입력")).filter((row) => row.some(Boolean)));
        }
      }
    }

    if (downRows.length) {
      const converted = buildFromDownRows(downRows);
      result.송장출력용.push(...converted.shipping);
      result.이카운트_송장입력.push(...converted.invoice);
      result.이카운트_판매입력.push(...converted.sale);
    }

    return NextResponse.json({ ok: true, files: parsedFiles, sheets: result });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "엑셀 파일 파싱 실패" }, { status: 500 });
  }
}

"use client";

import { Suspense, useEffect, useState } from "react";
import type { CSSProperties } from "react";
import { useSearchParams } from "next/navigation";
import * as XLSX from "xlsx";

type PreviewCell = {
  value: string;
  rowSpan: number;
  colSpan: number;
  style: CSSProperties;
};

type PreviewSheet = {
  name: string;
  rows: Array<Array<PreviewCell | null>>;
  colWidths: number[];
  rowHeights: number[];
};

function fileExtension(name: string, url: string) {
  const source = name || url.split("?")[0] || "";
  return source.split(".").pop()?.toLowerCase() || "";
}

function isImage(ext: string) {
  return ["jpg", "jpeg", "png", "webp", "gif"].includes(ext);
}

function isSpreadsheet(ext: string) {
  return ["xlsx", "xls", "xlsm", "csv"].includes(ext);
}

function isOfficeFile(ext: string) {
  return ["doc", "docx", "ppt", "pptx"].includes(ext);
}

async function downloadFile(url: string, name: string) {
  const response = await fetch(url);
  if (!response.ok) {
    window.open(url, "_blank", "noopener,noreferrer");
    return;
  }

  const blob = await response.blob();
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = objectUrl;
  anchor.download = name || "attachment";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(objectUrl);
}

function columnLabel(index: number) {
  let value = index + 1;
  let label = "";
  while (value > 0) {
    const rest = (value - 1) % 26;
    label = String.fromCharCode(65 + rest) + label;
    value = Math.floor((value - 1) / 26);
  }
  return label;
}

function cssColor(color?: { rgb?: string; indexed?: number }) {
  if (!color?.rgb) return undefined;
  const rgb = color.rgb.length === 8 ? color.rgb.slice(2) : color.rgb;
  return /^[0-9a-fA-F]{6}$/.test(rgb) ? `#${rgb}` : undefined;
}

function borderStyle(border?: Record<string, unknown>) {
  return border ? "1px solid #111827" : "1px solid #dbe4f0";
}

function cellStyle(cell: XLSX.CellObject | undefined): CSSProperties {
  const s = (cell as XLSX.CellObject & {
    s?: {
      alignment?: { horizontal?: string; vertical?: string; wrapText?: boolean };
      fill?: { fgColor?: { rgb?: string; indexed?: number } };
      font?: { bold?: boolean; italic?: boolean; sz?: number; name?: string; color?: { rgb?: string; indexed?: number } };
      border?: { top?: unknown; right?: unknown; bottom?: unknown; left?: unknown };
    };
  } | undefined)?.s;
  const horizontal = s?.alignment?.horizontal;
  const vertical = s?.alignment?.vertical;
  const backgroundColor = cssColor(s?.fill?.fgColor);
  const color = cssColor(s?.font?.color);

  return {
    backgroundColor,
    color,
    fontFamily: s?.font?.name || "맑은 고딕, Arial, sans-serif",
    fontSize: s?.font?.sz ? `${s.font.sz}px` : "12px",
    fontWeight: s?.font?.bold ? 800 : 500,
    fontStyle: s?.font?.italic ? "italic" : undefined,
    textAlign: horizontal === "center" ? "center" : horizontal === "right" ? "right" : "left",
    verticalAlign: vertical === "center" ? "middle" : vertical === "bottom" ? "bottom" : "top",
    whiteSpace: s?.alignment?.wrapText ? "normal" : "pre",
    overflow: "hidden",
    borderTop: borderStyle(s?.border?.top as Record<string, unknown> | undefined),
    borderRight: borderStyle(s?.border?.right as Record<string, unknown> | undefined),
    borderBottom: borderStyle(s?.border?.bottom as Record<string, unknown> | undefined),
    borderLeft: borderStyle(s?.border?.left as Record<string, unknown> | undefined),
  };
}

function buildPreviewSheet(worksheet: XLSX.WorkSheet, sheetName: string): PreviewSheet {
  const decoded = worksheet["!ref"] ? XLSX.utils.decode_range(worksheet["!ref"]) : { s: { r: 0, c: 0 }, e: { r: 0, c: 0 } };
  const maxRows = Math.min(200, decoded.e.r + 1);
  const maxCols = Math.min(50, decoded.e.c + 1);
  const merges = worksheet["!merges"] || [];
  const covered = new Set<string>();
  const spans = new Map<string, { rowSpan: number; colSpan: number }>();

  merges.forEach((merge) => {
    if (merge.s.r >= maxRows || merge.s.c >= maxCols) return;
    const rowSpan = Math.min(merge.e.r, maxRows - 1) - merge.s.r + 1;
    const colSpan = Math.min(merge.e.c, maxCols - 1) - merge.s.c + 1;
    spans.set(`${merge.s.r}:${merge.s.c}`, { rowSpan, colSpan });
    for (let r = merge.s.r; r <= Math.min(merge.e.r, maxRows - 1); r += 1) {
      for (let c = merge.s.c; c <= Math.min(merge.e.c, maxCols - 1); c += 1) {
        if (r !== merge.s.r || c !== merge.s.c) covered.add(`${r}:${c}`);
      }
    }
  });

  const colWidths = Array.from({ length: maxCols }, (_, index) => {
    const col = worksheet["!cols"]?.[index] as { wpx?: number; wch?: number } | undefined;
    return Math.min(Math.max(Math.round(col?.wpx || (col?.wch ? col.wch * 7 : 96)), 42), 360);
  });
  const rowHeights = Array.from({ length: maxRows }, (_, index) => {
    const row = worksheet["!rows"]?.[index] as { hpx?: number; hpt?: number } | undefined;
    return Math.min(Math.max(Math.round(row?.hpx || (row?.hpt ? row.hpt * 1.333 : 28)), 24), 180);
  });

  const rows = Array.from({ length: maxRows }, (_, r) => Array.from({ length: maxCols }, (_, c): PreviewCell | null => {
    if (covered.has(`${r}:${c}`)) return null;
    const address = XLSX.utils.encode_cell({ r, c });
    const cell = worksheet[address];
    const span = spans.get(`${r}:${c}`) || { rowSpan: 1, colSpan: 1 };
    return {
      value: String(cell?.w ?? cell?.v ?? ""),
      rowSpan: span.rowSpan,
      colSpan: span.colSpan,
      style: cellStyle(cell),
    };
  }));

  return { name: sheetName, rows, colWidths, rowHeights };
}

function SpreadsheetPreview({ url, name }: { url: string; name: string }) {
  const [preview, setPreview] = useState<PreviewSheet | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError("");
      try {
        const response = await fetch(url);
        if (!response.ok) throw new Error("파일을 불러오지 못했습니다.");
        const buffer = await response.arrayBuffer();
        const workbook = XLSX.read(buffer, { type: "array", cellDates: false, cellStyles: true });
        const firstSheetName = workbook.SheetNames[0];
        if (!firstSheetName) throw new Error("표시할 시트가 없습니다.");
        const worksheet = workbook.Sheets[firstSheetName];
        if (!cancelled) setPreview(buildPreviewSheet(worksheet, firstSheetName));
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "미리보기를 만들지 못했습니다.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [url]);

  if (loading) {
    return <section className="p-8 text-sm font-bold text-slate-500">엑셀 미리보기를 불러오는 중...</section>;
  }

  if (error || !preview) {
    return (
      <section className="flex min-h-[calc(100vh-65px)] items-center justify-center p-6">
        <div className="w-full max-w-xl rounded-md border border-slate-200 bg-white p-6 text-center shadow-sm">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-md bg-orange-50 text-lg font-black text-orange-600">XLSX</div>
          <h2 className="mt-4 break-all text-base font-black">{name}</h2>
          <p className="mt-2 text-sm font-bold text-slate-500">{error || "미리보기를 만들지 못했습니다."}</p>
        </div>
      </section>
    );
  }

  return (
    <section className="h-[calc(100vh-65px)] overflow-auto bg-white p-4">
      <div className="mb-3 flex items-center gap-2 text-sm font-black text-slate-700">
        <span className="rounded-md bg-orange-50 px-2 py-1 text-orange-600">{preview.name}</span>
        <span className="text-xs text-slate-500">최대 200행까지 미리보기</span>
      </div>
      <table className="border-collapse bg-white" style={{ tableLayout: "fixed" }}>
        <colgroup>
          <col style={{ width: 48 }} />
          {preview.colWidths.map((width, index) => <col key={index} style={{ width }} />)}
        </colgroup>
        <thead>
          <tr>
            <th className="sticky left-0 top-0 z-20 border border-slate-200 bg-slate-100 px-2 py-1 text-center text-xs font-black text-slate-500">#</th>
            {preview.colWidths.map((_, index) => (
              <th key={index} className="sticky top-0 z-10 border border-slate-200 bg-slate-100 px-2 py-1 text-center text-xs font-black text-slate-500">
                {columnLabel(index)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {preview.rows.map((row, rowIndex) => (
            <tr key={rowIndex} style={{ height: preview.rowHeights[rowIndex] }}>
              <th className="sticky left-0 z-10 border border-slate-200 bg-slate-50 px-2 py-1 text-center text-xs font-black text-slate-400">{rowIndex + 1}</th>
              {row.map((cell, colIndex) => cell ? (
                <td key={colIndex} rowSpan={cell.rowSpan} colSpan={cell.colSpan} className="px-2 py-1" style={cell.style}>
                  {cell.value}
                </td>
              ) : null)}
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function ViewerContent() {
  const searchParams = useSearchParams();
  const url = searchParams.get("url") || "";
  const name = searchParams.get("name") || "첨부파일";
  const ext = fileExtension(name, url);

  useEffect(() => {
    document.title = name;
  }, [name]);

  return (
    <main className="min-h-screen bg-slate-100 text-slate-950">
      <header className="flex items-center justify-between gap-4 border-b border-slate-200 bg-white px-5 py-3">
        <div className="min-w-0">
          <h1 className="truncate text-base font-black">{name}</h1>
          <p className="mt-1 text-xs font-bold text-slate-500">{ext ? ext.toUpperCase() : "FILE"}</p>
        </div>
        {url && (
          <button
            type="button"
            onClick={() => void downloadFile(url, name)}
            className="shrink-0 rounded-md bg-orange-500 px-3 py-2 text-sm font-black text-white hover:bg-orange-600"
          >
            파일 다운로드
          </button>
        )}
      </header>

      {!url ? (
        <section className="p-8 text-sm font-bold text-rose-600">파일 주소가 없습니다.</section>
      ) : isImage(ext) ? (
        <section className="flex min-h-[calc(100vh-65px)] items-center justify-center p-5">
          <img src={url} alt={name} className="max-h-[calc(100vh-110px)] max-w-full rounded-md bg-white object-contain shadow-sm" />
        </section>
      ) : ext === "pdf" ? (
        <iframe title={name} src={url} className="h-[calc(100vh-65px)] w-full border-0 bg-white" />
      ) : isSpreadsheet(ext) ? (
        <SpreadsheetPreview url={url} name={name} />
      ) : isOfficeFile(ext) ? (
        <section className="flex min-h-[calc(100vh-65px)] items-center justify-center p-6">
          <div className="w-full max-w-xl rounded-md border border-slate-200 bg-white p-6 text-center shadow-sm">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-md bg-orange-50 text-lg font-black text-orange-600">
              {ext ? ext.toUpperCase() : "FILE"}
            </div>
            <h2 className="mt-4 break-all text-base font-black">{name}</h2>
            <p className="mt-2 text-sm font-bold text-slate-500">이 문서 형식은 웹 미리보기를 지원하지 않습니다.</p>
          </div>
        </section>
      ) : (
        <section className="p-8">
          <div className="rounded-md border border-slate-200 bg-white p-6 shadow-sm">
            <p className="text-sm font-bold text-slate-600">이 파일 형식은 브라우저 미리보기를 지원하지 않을 수 있습니다.</p>
          </div>
        </section>
      )}
    </main>
  );
}

export default function AttachmentViewerPage() {
  return (
    <Suspense fallback={null}>
      <ViewerContent />
    </Suspense>
  );
}

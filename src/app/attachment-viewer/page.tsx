"use client";

import { Suspense, useEffect, useState } from "react";
import type { CSSProperties } from "react";
import { useSearchParams } from "next/navigation";
import JSZip from "jszip";
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
  images: PreviewImage[];
};

type PreviewImage = {
  id: string;
  src: string;
  left: number;
  top: number;
  width: number;
  height: number;
};

const ROW_HEADER_WIDTH = 48;
const COLUMN_HEADER_HEIGHT = 28;
const EMU_PER_PIXEL = 9525;

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

function parseXml(text: string) {
  return new DOMParser().parseFromString(text, "application/xml");
}

function xmlNodes(parent: ParentNode, localName: string) {
  return Array.from(parent.querySelectorAll("*")).filter((node) => node.localName === localName);
}

function firstXmlNode(parent: ParentNode, localName: string) {
  return xmlNodes(parent, localName)[0];
}

function xmlText(parent: ParentNode, localName: string) {
  return firstXmlNode(parent, localName)?.textContent?.trim() || "0";
}

function relId(node: Element, attrName = "id") {
  return node.getAttribute(`r:${attrName}`) || node.getAttributeNS("http://schemas.openxmlformats.org/officeDocument/2006/relationships", attrName) || "";
}

function relMap(xml: string) {
  const doc = parseXml(xml);
  const map = new Map<string, string>();
  xmlNodes(doc, "Relationship").forEach((node) => {
    const id = (node as Element).getAttribute("Id");
    const target = (node as Element).getAttribute("Target");
    if (id && target) map.set(id, target);
  });
  return map;
}

function resolveZipTarget(basePath: string, target: string) {
  if (!target) return "";
  const cleanTarget = target.replace(/\\/g, "/");
  if (cleanTarget.startsWith("/")) return cleanTarget.slice(1);
  if (cleanTarget.startsWith("xl/")) return cleanTarget;

  const parts = basePath.split("/").slice(0, -1);
  cleanTarget.split("/").forEach((part) => {
    if (!part || part === ".") return;
    if (part === "..") parts.pop();
    else parts.push(part);
  });
  return parts.join("/");
}

function emuToPx(value: string | number | null | undefined) {
  return Math.round(Number(value || 0) / EMU_PER_PIXEL);
}

function sumBefore(values: number[], index: number) {
  return values.slice(0, Math.max(0, index)).reduce((sum, value) => sum + value, 0);
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function imageMimeType(path: string) {
  const ext = path.split(".").pop()?.toLowerCase();
  if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
  if (ext === "webp") return "image/webp";
  if (ext === "gif") return "image/gif";
  return "image/png";
}

type AnchorMarker = {
  col: number;
  row: number;
  colOff: number;
  rowOff: number;
};

type ImageAnchor = {
  id: string;
  src: string;
  from: AnchorMarker;
  to?: AnchorMarker;
  extWidth: number;
  extHeight: number;
  naturalWidth: number;
  naturalHeight: number;
};

function anchorMarker(node: Element, localName: "from" | "to"): AnchorMarker | null {
  const point = firstXmlNode(node, localName) as Element | undefined;
  if (!point) return null;

  const col = Number(xmlText(point, "col") || 0);
  const row = Number(xmlText(point, "row") || 0);
  const colOff = emuToPx(xmlText(point, "colOff"));
  const rowOff = emuToPx(xmlText(point, "rowOff"));

  return { col, row, colOff, rowOff };
}

function markerPoint(marker: AnchorMarker, colWidths: number[], rowHeights: number[]) {
  return {
    left: ROW_HEADER_WIDTH + sumBefore(colWidths, marker.col) + marker.colOff,
    top: COLUMN_HEADER_HEIGHT + sumBefore(rowHeights, marker.row) + marker.rowOff,
  };
}

function loadImageSize(src: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve) => {
    const image = new window.Image();
    image.onload = () => resolve({ width: image.naturalWidth || image.width || 0, height: image.naturalHeight || image.height || 0 });
    image.onerror = () => resolve({ width: 0, height: 0 });
    image.src = src;
  });
}

async function extractSheetImages(buffer: ArrayBuffer, sheetName: string, colWidths: number[], rowHeights: number[]): Promise<PreviewImage[]> {
  try {
    const zip = await JSZip.loadAsync(buffer);
    const workbookXml = await zip.file("xl/workbook.xml")?.async("text");
    const workbookRelsXml = await zip.file("xl/_rels/workbook.xml.rels")?.async("text");
    if (!workbookXml || !workbookRelsXml) return [];

    const workbookDoc = parseXml(workbookXml);
    const sheetNode = xmlNodes(workbookDoc, "sheet").find((node) => (node as Element).getAttribute("name") === sheetName) as Element | undefined;
    const sheetRelId = sheetNode ? relId(sheetNode) : "";
    if (!sheetRelId) return [];

    const workbookRels = relMap(workbookRelsXml);
    const sheetPath = resolveZipTarget("xl/workbook.xml", workbookRels.get(sheetRelId) || "");
    const sheetRelPath = sheetPath.replace(/^(.+\/)([^/]+)$/, "$1_rels/$2.rels");
    const sheetRelsXml = await zip.file(sheetRelPath)?.async("text");
    if (!sheetRelsXml) return [];

    const drawingTarget = Array.from(relMap(sheetRelsXml).values()).find((target) => target.includes("drawing"));
    if (!drawingTarget) return [];

    const drawingPath = resolveZipTarget(sheetPath, drawingTarget);
    const drawingXml = await zip.file(drawingPath)?.async("text");
    const drawingRelsPath = drawingPath.replace(/^(.+\/)([^/]+)$/, "$1_rels/$2.rels");
    const drawingRelsXml = await zip.file(drawingRelsPath)?.async("text");
    if (!drawingXml || !drawingRelsXml) return [];

    const drawingRels = relMap(drawingRelsXml);
    const drawingDoc = parseXml(drawingXml);
    const anchors = [...xmlNodes(drawingDoc, "twoCellAnchor"), ...xmlNodes(drawingDoc, "oneCellAnchor")] as Element[];
    const imageAnchors: ImageAnchor[] = [];

    for (const [index, anchor] of anchors.entries()) {
      const blip = firstXmlNode(anchor, "blip") as Element | undefined;
      const imageRelId = blip ? relId(blip, "embed") : "";
      const mediaTarget = imageRelId ? drawingRels.get(imageRelId) : "";
      if (!mediaTarget) continue;

      const mediaPath = resolveZipTarget(drawingPath, mediaTarget);
      const mediaFile = zip.file(mediaPath);
      if (!mediaFile) continue;

      const from = anchorMarker(anchor, "from");
      if (!from) continue;
      const to = anchorMarker(anchor, "to") || undefined;
      const extNode = firstXmlNode(anchor, "ext") as Element | undefined;
      const extWidth = emuToPx(extNode?.getAttribute("cx"));
      const extHeight = emuToPx(extNode?.getAttribute("cy"));

      const blob = await mediaFile.async("blob");
      const src = URL.createObjectURL(new Blob([blob], { type: imageMimeType(mediaPath) }));
      const size = await loadImageSize(src);
      imageAnchors.push({
        id: `${mediaPath}-${index}`,
        src,
        from,
        to,
        extWidth,
        extHeight,
        naturalWidth: size.width,
        naturalHeight: size.height,
      });
    }

    imageAnchors.forEach((image) => {
      const fallbackWidth = image.extWidth || image.naturalWidth || 120;
      const fallbackHeight = image.extHeight || image.naturalHeight || 90;
      const rowSpan = image.to ? Math.max(1, image.to.row - image.from.row) : 1;
      const colSpan = image.to ? Math.max(1, image.to.col - image.from.col) : 1;

      if (rowSpan <= 2 && image.from.row < rowHeights.length) {
        rowHeights[image.from.row] = Math.max(rowHeights[image.from.row], clamp(fallbackHeight + 10, 54, 118));
      }
      if (colSpan <= 2 && image.from.col < colWidths.length) {
        colWidths[image.from.col] = Math.max(colWidths[image.from.col], clamp(fallbackWidth + 12, 74, 190));
      }
    });

    const images = imageAnchors.map((image) => {
      const from = markerPoint(image.from, colWidths, rowHeights);
      const to = image.to ? markerPoint(image.to, colWidths, rowHeights) : null;
      const boxWidth = Math.max(24, to ? to.left - from.left : image.extWidth || image.naturalWidth || 120);
      const boxHeight = Math.max(24, to ? to.top - from.top : image.extHeight || image.naturalHeight || 90);
      const naturalWidth = image.naturalWidth || boxWidth;
      const naturalHeight = image.naturalHeight || boxHeight;
      const padding = 5;
      const scale = Math.min((boxWidth - padding * 2) / naturalWidth, (boxHeight - padding * 2) / naturalHeight);
      const width = Math.max(20, Math.round(naturalWidth * scale));
      const height = Math.max(20, Math.round(naturalHeight * scale));
      const left = Math.round(from.left + (boxWidth - width) / 2);
      const top = Math.round(from.top + (boxHeight - height) / 2);

      return { id: image.id, src: image.src, left, top, width, height };
    });

    return images;
  } catch {
    return [];
  }
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

  return { name: sheetName, rows, colWidths, rowHeights, images: [] };
}

function SpreadsheetPreview({ url, name }: { url: string; name: string }) {
  const [preview, setPreview] = useState<PreviewSheet | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    let imageUrls: string[] = [];

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
        const sheetPreview = buildPreviewSheet(worksheet, firstSheetName);
        const images = await extractSheetImages(buffer, firstSheetName, sheetPreview.colWidths, sheetPreview.rowHeights);
        imageUrls = images.map((image) => image.src);
        if (!cancelled) {
          setPreview({ ...sheetPreview, images });
        } else {
          imageUrls.forEach((src) => URL.revokeObjectURL(src));
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "미리보기를 만들지 못했습니다.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();
    return () => {
      cancelled = true;
      imageUrls.forEach((src) => URL.revokeObjectURL(src));
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
      <div className="relative inline-block">
        <table className="border-collapse bg-white" style={{ tableLayout: "fixed" }}>
          <colgroup>
            <col style={{ width: ROW_HEADER_WIDTH }} />
            {preview.colWidths.map((width, index) => <col key={index} style={{ width }} />)}
          </colgroup>
          <thead>
            <tr style={{ height: COLUMN_HEADER_HEIGHT }}>
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
        {preview.images.map((image) => (
          <img
            key={image.id}
            src={image.src}
            alt=""
            className="pointer-events-none absolute z-[5] object-contain"
            style={{ left: image.left, top: image.top, width: image.width, height: image.height }}
          />
        ))}
      </div>
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

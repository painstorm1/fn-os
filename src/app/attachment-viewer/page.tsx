"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import * as XLSX from "xlsx";

type SheetCell = string | number | boolean | null;

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

function SpreadsheetPreview({ url, name }: { url: string; name: string }) {
  const [rows, setRows] = useState<SheetCell[][]>([]);
  const [sheetName, setSheetName] = useState("");
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
        const workbook = XLSX.read(buffer, { type: "array", cellDates: false });
        const firstSheetName = workbook.SheetNames[0];
        if (!firstSheetName) throw new Error("표시할 시트가 없습니다.");
        const worksheet = workbook.Sheets[firstSheetName];
        const matrix = XLSX.utils.sheet_to_json<SheetCell[]>(worksheet, { header: 1, defval: "", raw: false });
        if (!cancelled) {
          setSheetName(firstSheetName);
          setRows(matrix.slice(0, 200));
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
    };
  }, [url]);

  const columnCount = useMemo(() => Math.min(50, Math.max(1, ...rows.map((row) => row.length))), [rows]);

  if (loading) {
    return <section className="p-8 text-sm font-bold text-slate-500">엑셀 미리보기를 불러오는 중...</section>;
  }

  if (error) {
    return (
      <section className="flex min-h-[calc(100vh-65px)] items-center justify-center p-6">
        <div className="w-full max-w-xl rounded-md border border-slate-200 bg-white p-6 text-center shadow-sm">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-md bg-orange-50 text-lg font-black text-orange-600">
            XLSX
          </div>
          <h2 className="mt-4 break-all text-base font-black">{name}</h2>
          <p className="mt-2 text-sm font-bold text-slate-500">{error}</p>
        </div>
      </section>
    );
  }

  return (
    <section className="h-[calc(100vh-65px)] overflow-auto bg-white p-4">
      <div className="mb-3 flex items-center gap-2 text-sm font-black text-slate-700">
        <span className="rounded-md bg-orange-50 px-2 py-1 text-orange-600">{sheetName}</span>
        <span className="text-xs text-slate-500">최대 200행까지 미리보기</span>
      </div>
      <table className="min-w-full border-collapse text-sm">
        <thead>
          <tr>
            <th className="sticky left-0 top-0 z-20 w-12 border border-slate-200 bg-slate-100 px-2 py-1 text-center text-xs font-black text-slate-500">#</th>
            {Array.from({ length: columnCount }).map((_, index) => (
              <th key={index} className="sticky top-0 z-10 min-w-28 border border-slate-200 bg-slate-100 px-2 py-1 text-center text-xs font-black text-slate-500">
                {columnLabel(index)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, rowIndex) => (
            <tr key={rowIndex}>
              <th className="sticky left-0 z-10 border border-slate-200 bg-slate-50 px-2 py-1 text-center text-xs font-black text-slate-400">{rowIndex + 1}</th>
              {Array.from({ length: columnCount }).map((_, colIndex) => (
                <td key={colIndex} className="max-w-[360px] whitespace-nowrap border border-slate-200 px-2 py-1 align-top text-slate-800">
                  {String(row[colIndex] ?? "")}
                </td>
              ))}
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

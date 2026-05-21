"use client";

import { Suspense, useEffect, useMemo } from "react";
import { useSearchParams } from "next/navigation";

function fileExtension(name: string, url: string) {
  const source = name || url.split("?")[0] || "";
  return source.split(".").pop()?.toLowerCase() || "";
}

function isImage(ext: string) {
  return ["jpg", "jpeg", "png", "webp", "gif"].includes(ext);
}

function isSheet(ext: string) {
  return ["xlsx", "xls", "xlsm", "csv"].includes(ext);
}

function isDocument(ext: string) {
  return ["doc", "docx", "ppt", "pptx"].includes(ext);
}

function ViewerContent() {
  const searchParams = useSearchParams();
  const url = searchParams.get("url") || "";
  const name = searchParams.get("name") || "첨부파일";
  const ext = fileExtension(name, url);

  useEffect(() => {
    document.title = name;
  }, [name]);

  const viewerUrl = useMemo(() => {
    if (!url) return "";
    if (isSheet(ext) || isDocument(ext)) {
      return `https://docs.google.com/gview?embedded=1&url=${encodeURIComponent(url)}`;
    }
    return url;
  }, [ext, url]);

  return (
    <main className="min-h-screen bg-slate-100 text-slate-950">
      <header className="flex items-center justify-between gap-4 border-b border-slate-200 bg-white px-5 py-3">
        <div className="min-w-0">
          <h1 className="truncate text-base font-black">{name}</h1>
          <p className="mt-1 text-xs font-bold text-slate-500">{ext ? ext.toUpperCase() : "FILE"}</p>
        </div>
        {url && (
          <a
            href={url}
            target="_blank"
            rel="noreferrer"
            className="shrink-0 rounded-md border border-slate-300 px-3 py-2 text-sm font-black text-slate-700 hover:bg-slate-50"
          >
            원본 열기
          </a>
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
      ) : isSheet(ext) || isDocument(ext) ? (
        <iframe title={name} src={viewerUrl} className="h-[calc(100vh-65px)] w-full border-0 bg-white" />
      ) : (
        <section className="p-8">
          <div className="rounded-md border border-slate-200 bg-white p-6 shadow-sm">
            <p className="text-sm font-bold text-slate-600">이 파일 형식은 브라우저 미리보기를 지원하지 않을 수 있습니다.</p>
            <a href={url} target="_blank" rel="noreferrer" className="mt-4 inline-flex rounded-md bg-orange-500 px-4 py-2 text-sm font-black text-white">
              원본 열기
            </a>
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

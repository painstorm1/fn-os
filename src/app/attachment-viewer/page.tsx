"use client";

import { Suspense, useEffect } from "react";
import { useSearchParams } from "next/navigation";

function fileExtension(name: string, url: string) {
  const source = name || url.split("?")[0] || "";
  return source.split(".").pop()?.toLowerCase() || "";
}

function isImage(ext: string) {
  return ["jpg", "jpeg", "png", "webp", "gif"].includes(ext);
}

function isOfficeFile(ext: string) {
  return ["xlsx", "xls", "xlsm", "csv", "doc", "docx", "ppt", "pptx"].includes(ext);
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
      ) : isOfficeFile(ext) ? (
        <section className="flex min-h-[calc(100vh-65px)] items-center justify-center p-6">
          <div className="w-full max-w-xl rounded-md border border-slate-200 bg-white p-6 text-center shadow-sm">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-md bg-orange-50 text-lg font-black text-orange-600">
              {ext ? ext.toUpperCase() : "FILE"}
            </div>
            <h2 className="mt-4 break-all text-base font-black">{name}</h2>
            <p className="mt-2 text-sm font-bold text-slate-500">
              엑셀/문서 파일은 브라우저 보안 정책 때문에 웹 미리보기가 차단될 수 있습니다.
            </p>
            <div className="mt-5 flex justify-center gap-2">
              <button
                type="button"
                onClick={() => void downloadFile(url, name)}
                className="rounded-md bg-orange-500 px-4 py-2 text-sm font-black text-white hover:bg-orange-600"
              >
                파일 다운로드
              </button>
              <a
                href={url}
                target="_blank"
                rel="noreferrer"
                className="rounded-md border border-slate-300 px-4 py-2 text-sm font-black text-slate-700 hover:bg-slate-50"
              >
                원본 열기
              </a>
            </div>
          </div>
        </section>
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

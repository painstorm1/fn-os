"use client";

import { useEffect, useState } from "react";

const LOADING_MESSAGE = "\uac70\ub798 \ubd84\uc11d \ud654\uba74\uc744 \ubd88\ub7ec\uc624\ub294 \uc911\uc785\ub2c8\ub2e4.";
const EMPTY_MESSAGE =
  "\uac70\ub798 \ubd84\uc11d \ub370\uc774\ud130\uac00 \uc5c6\uc2b5\ub2c8\ub2e4. FN OS\uc5d0\uc11c \uac70\ub798 \ubd84\uc11d \ubc84\ud2bc\uc744 \ub2e4\uc2dc \ub20c\ub7ec\uc8fc\uc138\uc694.";

function readStoredHtml(key: string) {
  const storageKey = key ? `fnos:${key}` : "";
  return (
    (storageKey ? sessionStorage.getItem(storageKey) : "") ||
    (storageKey ? localStorage.getItem(storageKey) : "") ||
    localStorage.getItem("fnos:lastTradeAnalysisHtml") ||
    ""
  );
}

export default function TradeAnalysisPopupPage() {
  const [message, setMessage] = useState(LOADING_MESSAGE);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const key = params.get("key") || localStorage.getItem("fnos:lastTradeAnalysisKey") || "";
    const html = readStoredHtml(key);
    if (!html) {
      setMessage(EMPTY_MESSAGE);
      return;
    }
    document.open();
    document.write(html);
    document.close();
  }, []);

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 p-8 text-center text-sm font-black text-slate-600">
      {message}
    </main>
  );
}

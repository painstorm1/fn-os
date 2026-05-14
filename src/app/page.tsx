"use client";

import Image from "next/image";
import Link from "next/link";
import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";

const IMPORT_ERP_URL = process.env.NEXT_PUBLIC_IMPORT_ERP_URL || "http://localhost:5500";

const mainMenus = [
  "대시보드",
  "매출/재고",
  "수입관리",
  "광고분석",
  "회계/비용",
  "아카이브",
];

const importSubMenus = [
  { label: "발주", path: "/orders" },
  { label: "제품", path: "/products" },
  { label: "설정", path: "/settings" },
];

const menuSlugs: Record<string, string> = {
  대시보드: "dashboard",
  "매출/재고": "sales",
  수입관리: "import",
  광고분석: "ads",
  "회계/비용": "accounting",
  아카이브: "archive",
};

const slugMenus = Object.fromEntries(Object.entries(menuSlugs).map(([key, value]) => [value, key]));

const kpis = [
  { label: "오늘 매출", value: "1,284,000원", tone: "text-emerald-600", note: "+12.4%" },
  { label: "광고비", value: "182,500원", tone: "text-sky-600", note: "ROAS 421%" },
  { label: "예상 순이익", value: "386,000원", tone: "text-orange-600", note: "마진 30.1%" },
  { label: "재고 위험", value: "7 SKU", tone: "text-rose-600", note: "3개 긴급" },
];

function formatDateKey(date: Date) {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}

function CalendarMemo() {
  const today = useMemo(() => new Date(), []);
  const [viewDate, setViewDate] = useState(new Date(today.getFullYear(), today.getMonth(), 1));
  const [selected, setSelected] = useState(formatDateKey(today));
  const [memoText, setMemoText] = useState("");
  const [memos, setMemos] = useState<Record<string, string[]>>({});

  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        setMemos(JSON.parse(localStorage.getItem("fn-import-erp-calendar-memos") || "{}"));
      } catch {
        setMemos({});
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  const year = viewDate.getFullYear();
  const month = viewDate.getMonth();
  const first = new Date(year, month, 1);
  const last = new Date(year, month + 1, 0);
  const blanks = Array.from({ length: first.getDay() });
  const days = Array.from({ length: last.getDate() }, (_, index) => index + 1);

  function saveMemos(next: Record<string, string[]>) {
    setMemos(next);
    localStorage.setItem("fn-import-erp-calendar-memos", JSON.stringify(next));
  }

  function addMemo() {
    const text = memoText.trim();
    if (!text) return;
    saveMemos({ ...memos, [selected]: [...(memos[selected] || []), text] });
    setMemoText("");
  }

  function deleteMemo(index: number) {
    const nextItems = [...(memos[selected] || [])];
    nextItems.splice(index, 1);
    const next = { ...memos };
    if (nextItems.length) next[selected] = nextItems;
    else delete next[selected];
    saveMemos(next);
  }

  return (
    <section className="px-1 py-2">
      <div className="mb-3 flex items-center justify-between">
        <button
          type="button"
          className="h-8 w-8 rounded-md text-lg font-black text-slate-500 hover:bg-slate-100"
          onClick={() => setViewDate(new Date(year, month - 1, 1))}
          aria-label="이전 달"
        >
          ‹
        </button>
        <strong className="text-base font-black">{year}년 {month + 1}월</strong>
        <button
          type="button"
          className="h-8 w-8 rounded-md text-lg font-black text-slate-500 hover:bg-slate-100"
          onClick={() => setViewDate(new Date(year, month + 1, 1))}
          aria-label="다음 달"
        >
          ›
        </button>
      </div>
      <div className="grid grid-cols-7 text-center text-xs font-black text-slate-400">
        {["일", "월", "화", "수", "목", "금", "토"].map((day) => (
          <span key={day}>{day}</span>
        ))}
      </div>
      <div className="mt-2 grid grid-cols-7 gap-1 text-center text-sm">
        {blanks.map((_, index) => <span key={`blank-${index}`} />)}
        {days.map((day) => {
          const key = formatDateKey(new Date(year, month, day));
          const isSelected = key === selected;
          const hasMemo = Boolean(memos[key]?.length);
          return (
            <button
              key={key}
              type="button"
              onClick={() => setSelected(key)}
              className={`relative h-8 rounded-md font-bold ${
                isSelected ? "bg-orange-500 text-white" : "text-slate-700 hover:bg-slate-100"
              }`}
            >
              {day}
              {hasMemo && <span className="absolute bottom-1 left-1/2 h-1 w-1 -translate-x-1/2 rounded-full bg-current" />}
            </button>
          );
        })}
      </div>
      <div className="mt-4 pt-2">
        <strong className="text-xs font-bold text-slate-500">{selected}</strong>
        <div className="mt-2 space-y-1">
          {(memos[selected] || []).map((memo, index) => (
            <div key={`${memo}-${index}`} className="flex items-start justify-between gap-2 text-xs">
              <span className="break-all">• {memo}</span>
              <button type="button" className="text-slate-400 hover:text-rose-500" onClick={() => deleteMemo(index)}>
                ×
              </button>
            </div>
          ))}
        </div>
        <div className="mt-2 flex gap-1">
          <input
            value={memoText}
            onChange={(event) => setMemoText(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") addMemo();
            }}
            className="min-w-0 flex-1 rounded-md border border-slate-200 px-2 py-2 text-xs outline-orange-400"
            placeholder="일정 입력"
          />
          <button type="button" onClick={addMemo} className="rounded-md bg-orange-500 px-3 text-xs font-black text-white">
            저장
          </button>
        </div>
      </div>
    </section>
  );
}

function LeftSidebar({ activeMenu, importPath }: { activeMenu: string; importPath: string }) {
  return (
    <aside className="hidden h-screen w-[280px] shrink-0 overflow-y-auto border-r border-slate-200 bg-white px-6 py-5 lg:block">
      <Link href="/?menu=dashboard" className="mb-4 block">
        <Image src="/fn-logo.jpg" alt="F&" width={88} height={88} className="object-contain" priority />
      </Link>

      <nav className="space-y-1">
        {mainMenus.map((item) => (
          <div key={item}>
            <Link
              href={`/?menu=${menuSlugs[item]}`}
              className={`flex h-11 w-full items-center rounded-md px-3 text-left text-sm font-black transition ${
                item === activeMenu ? "bg-slate-950 text-white" : "text-slate-600 hover:bg-slate-100"
              }`}
            >
              {item}
            </Link>
            {item === "수입관리" && activeMenu === "수입관리" && (
              <div className="ml-3 mt-1 space-y-1 border-l border-slate-200 pl-3">
                {importSubMenus.map((sub) => (
                  <Link
                    key={sub.path}
                    href={`/?menu=import&section=${encodeURIComponent(sub.path)}`}
                    className={`flex h-9 w-full items-center rounded-md px-3 text-left text-xs font-black ${
                      importPath === sub.path ? "bg-orange-50 text-orange-600" : "text-slate-500 hover:bg-slate-50"
                    }`}
                  >
                    {sub.label}
                  </Link>
                ))}
              </div>
            )}
          </div>
        ))}
      </nav>

      <div className="mt-5">
        <CalendarMemo />
      </div>
    </aside>
  );
}

function ToolSection({ title, children, defaultOpen = false }: { title: string; children: React.ReactNode; defaultOpen?: boolean }) {
  return (
    <details className="mb-3 rounded-md border border-slate-200 bg-white" open={defaultOpen}>
      <summary className="cursor-pointer rounded-md bg-slate-50 px-3 py-3 text-sm font-black">{title}</summary>
      <div className="border-t border-slate-100 p-3">{children}</div>
    </details>
  );
}

function AddressBlock({ text, href }: { text: string; href?: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1200);
  }

  return (
    <div className="relative pt-10">
      {href && (
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className="absolute right-1 top-0 flex h-7 w-7 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100 hover:text-orange-600"
          title="사이트 열기"
        >
          ↗
        </a>
      )}
      <button
        type="button"
        onClick={copy}
        className="absolute right-1 top-9 rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] font-bold text-slate-500 hover:text-orange-600"
      >
        {copied ? "완료" : "복사"}
      </button>
      <pre className="whitespace-pre-wrap rounded-md border border-slate-200 bg-slate-50 p-3 pr-14 text-xs leading-7 text-slate-700">{text}</pre>
    </div>
  );
}

function RightTools() {
  const [productName, setProductName] = useState("");
  const [gptResult, setGptResult] = useState("제품명을 입력하고 HS/관세 물어보기를 눌러주세요.");
  const [gptLoading, setGptLoading] = useState(false);
  const [lcl, setLcl] = useState({ method: "LCL(월수금)", w: "", d: "", h: "", box: "", origin: false });
  const [lclResult, setLclResult] = useState("CBM을 입력하면 배송비가 계산됩니다.");

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const saved = localStorage.getItem("fn-os-gptmini-last-result");
      if (saved) {
        try {
          const parsed = JSON.parse(saved) as { productName?: string; answer?: string };
          if (parsed.productName) setProductName(parsed.productName);
          if (parsed.answer) setGptResult(parsed.answer);
        } catch {
          localStorage.removeItem("fn-os-gptmini-last-result");
        }
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  function lclCbm() {
    return (
      (Number(lcl.w) || 0) *
      (Number(lcl.d) || 0) *
      (Number(lcl.h) || 0) *
      (Number(lcl.box) || 0) /
      1000000
    );
  }

  async function calcLcl(next = lcl) {
    const cbm =
      (Number(next.w) || 0) *
      (Number(next.d) || 0) *
      (Number(next.h) || 0) *
      (Number(next.box) || 0) /
      1000000;
    if (!cbm) {
      setLclResult("CBM을 입력하면 배송비가 계산됩니다.");
      return;
    }
    try {
      const res = await fetch(`${IMPORT_ERP_URL}/api/lcl-fee?method=${encodeURIComponent(next.method)}&cbm=${encodeURIComponent(cbm.toFixed(3))}`, {
        credentials: "include",
      });
      const data = await res.json();
      const originFee = next.origin ? data.origin_certificate : 0;
      const total = data.shipping_fee + originFee + data.bl_charge + data.forwarder_hc + data.cwc_krw;
      const won = (n: number) => `${Math.round(n || 0).toLocaleString("ko-KR")}원`;
      setLclResult([
        `배송방식: ${next.method}`,
        `총 CBM: ${cbm.toFixed(3)}`,
        `해운비: ${won(data.shipping_fee)}`,
        `원산지 증명: ${next.origin ? won(originFee) : "-"}`,
        `BL 차지비: ${won(data.bl_charge)}`,
        `포워더 HC: ${won(data.forwarder_hc)}`,
        `CWC: $${data.cwc_usd} x USD환율 ${Math.round(data.usd_rate).toLocaleString("ko-KR")} = ${won(data.cwc_krw)}`,
        `총 금액: ${won(total)}`,
      ].join("\n"));
    } catch {
      setLclResult("수입ERP 서버 연결을 확인해 주세요. localhost:5500이 켜져 있어야 계산됩니다.");
    }
  }

  function updateLcl(patch: Partial<typeof lcl>) {
    const next = { ...lcl, ...patch };
    setLcl(next);
    void calcLcl(next);
  }

  async function askGptMini() {
    const name = productName.trim();
    if (!name) return;
    setGptLoading(true);
    setGptResult("GPTmini 조회 중...");
    try {
      const res = await fetch(`${IMPORT_ERP_URL}/api/gptmini/hs`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ product_name: name }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "GPTmini 호출 실패");
      localStorage.setItem(
        "fn-os-gptmini-last-result",
        JSON.stringify({ productName: name, answer: data.answer, ts: Date.now() })
      );
      setGptResult(data.answer);
    } catch (error) {
      setGptResult(error instanceof Error ? error.message : "수입ERP 서버 연결을 확인해 주세요.");
    } finally {
      setGptLoading(false);
    }
  }

  return (
    <aside className="hidden h-screen w-[320px] shrink-0 overflow-y-auto border-l border-slate-200 bg-white px-4 py-6 xl:block">
      <ToolSection title="GPTmini (HS코드&관세율)" defaultOpen>
        <input
          value={productName}
          onChange={(event) => setProductName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") void askGptMini();
          }}
          className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm"
          placeholder="제품명 입력"
        />
        <button
          type="button"
          disabled={gptLoading}
          onClick={askGptMini}
          className="mt-2 w-full rounded-md bg-orange-500 px-3 py-2 text-sm font-black text-white disabled:opacity-60"
        >
          {gptLoading ? "조회 중..." : "HS/관세 물어보기"}
        </button>
        <div className="mt-2 min-h-24 whitespace-pre-wrap rounded-md border border-slate-200 bg-slate-50 p-3 text-xs leading-5 text-slate-600">
          {gptResult}
        </div>
      </ToolSection>

      <ToolSection title="LCL 배송요금" defaultOpen>
        <select
          value={lcl.method}
          onChange={(event) => updateLcl({ method: event.target.value })}
          className="mb-2 w-full rounded-md border border-slate-200 px-2 py-2 text-xs"
        >
          <option>LCL(월수금)</option>
          <option>LCL(화목일)</option>
        </select>
        <div className="grid grid-cols-2 gap-2">
          {[
            ["w", "가로 cm"],
            ["d", "세로 cm"],
            ["h", "높이 cm"],
            ["box", "박스 수"],
          ].map(([key, label]) => (
            <input
              key={key}
              value={lcl[key as "w" | "d" | "h" | "box"]}
              onChange={(event) => updateLcl({ [key]: event.target.value })}
              className="rounded-md border border-slate-200 px-2 py-2 text-xs"
              placeholder={label}
              type="number"
            />
          ))}
        </div>
        <label className="mt-2 flex items-center gap-2 text-xs font-bold text-slate-600">
          <input type="checkbox" checked={lcl.origin} onChange={(event) => updateLcl({ origin: event.target.checked })} />
          원산지 증명
        </label>
        <div className="mt-3 rounded-md bg-orange-50 p-3 text-sm font-black text-orange-600">총 CBM {lclCbm().toFixed(3)}</div>
        <pre className="mt-2 whitespace-pre-wrap rounded-md border border-slate-200 bg-slate-50 p-3 text-xs leading-5 text-slate-600">{lclResult}</pre>
      </ToolSection>

      <ToolSection title="타배 위해 주소">
        <AddressBlock
          href="https://www.tabae.co.kr/"
          text={`우편번호(邮政编码) : 264205

성(省) : 山东省

시(市) : 威海市

상세주소(详细地址) : 环翠区凤林街道

나의사서함번호 : 梧桐路南500米景和光
电院内2号仓库/TB77624

연락처(联系方式) : 18563144074`}
        />
      </ToolSection>

      <ToolSection title="짐패스 도쿄 주소">
        <AddressBlock
          href="https://www.jimpass.com/"
          text={`우편번호 (郵便番号) : 103-0015

도도부현 (都道府県) : 東京都

시구, 번지 (住所1) : 中央区日本橋箱崎町44-7

그밖의 주소(住所2) : 4階 JK65203

전화번호 (電話番号) : 03-3527-3876`}
        />
      </ToolSection>

      <ToolSection title="FN 영문주소">
        <AddressBlock
          text={`FN(KIM JAEWOOK)

FNcompany 42-19, Baegok-daero 2101beon-gil, Mohyeon-eup
Cheoin-gu Yongin-si, Gyeonggi-do, Republic of Korea

postcode 17037
Phone (+82), 1033748934`}
        />
      </ToolSection>
    </aside>
  );
}

function Dashboard() {
  return (
    <div className="space-y-6">
      <section className="grid gap-4 md:grid-cols-2 2xl:grid-cols-4">
        {kpis.map((item) => (
          <article key={item.label} className="rounded-md border border-slate-200 bg-white p-5 shadow-sm">
            <p className="text-sm font-bold text-slate-500">{item.label}</p>
            <p className="mt-3 text-2xl font-black">{item.value}</p>
            <p className={`mt-2 text-sm font-bold ${item.tone}`}>{item.note}</p>
          </article>
        ))}
      </section>

      <section className="rounded-md border border-slate-200 bg-white p-5 shadow-sm">
        <div className="mb-4">
          <h2 className="text-lg font-black">수입제품 현황</h2>
          <p className="mt-1 text-sm text-slate-500">기존 수입ERP 대시보드 내용을 FN OS 안에서 확인합니다.</p>
        </div>
        <ImportFrame path="/" compact />
      </section>
    </div>
  );
}

function withEmbedParam(path: string) {
  const [pathname, query = ""] = path.split("?");
  const params = new URLSearchParams(query);
  params.set("embed", "1");
  return `${pathname}?${params.toString()}`;
}

function ImportFrame({ path, compact = false }: { path: string; compact?: boolean }) {
  const src = `${IMPORT_ERP_URL}${withEmbedParam(path)}`;
  return (
    <div className={`overflow-hidden rounded-md border border-slate-200 bg-white ${compact ? "h-[560px]" : "h-[calc(100vh-48px)]"}`}>
      <iframe title="수입ERP" src={src} className="h-full w-full border-0" />
    </div>
  );
}

function HomeContent() {
  const searchParams = useSearchParams();
  const activeMenu = slugMenus[searchParams.get("menu") || "dashboard"] || "대시보드";
  const importPath = searchParams.get("section") || "/orders";

  return (
    <main className="min-h-screen bg-[#f6f7f9] text-slate-950">
      <div className="flex min-h-screen">
        <LeftSidebar activeMenu={activeMenu} importPath={importPath} />
        <section className="min-w-0 flex-1 px-5 py-6 sm:px-7">
          {activeMenu === "수입관리" ? (
            <ImportFrame path={importPath} />
          ) : activeMenu === "대시보드" ? (
            <Dashboard />
          ) : (
            <section className="rounded-md border border-slate-200 bg-white p-8 shadow-sm">
              <h1 className="text-2xl font-black">{activeMenu}</h1>
              <p className="mt-2 text-sm text-slate-500">이 메뉴는 다음 단계에서 실제 데이터와 기능을 연결할 영역입니다.</p>
            </section>
          )}
        </section>
        {activeMenu === "수입관리" && <RightTools />}
      </div>
    </main>
  );
}

export default function Home() {
  return (
    <Suspense fallback={null}>
      <HomeContent />
    </Suspense>
  );
}

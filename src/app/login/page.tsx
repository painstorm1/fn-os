"use client";

import Image from "next/image";
import { FormEvent, useState } from "react";

export default function LoginPage() {
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);

    const response = await fetch("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });

    setLoading(false);
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      window.alert(data.error || "로그인에 실패했습니다.");
      return;
    }

    const params = new URLSearchParams(window.location.search);
    window.location.href = params.get("next") || "/";
  }

  return (
    <main className="grid min-h-screen place-items-center bg-[#f9fafb] px-5 text-gray-900">
      <form onSubmit={submit} className="w-full max-w-[420px] rounded-2xl border border-gray-200 bg-white p-8 shadow-[0_12px_40px_rgba(17,24,39,0.08)]">
        <Image src="/fn-logo.jpg" alt="F&" width={92} height={92} className="mb-6 object-contain" priority />
        <h1 className="text-[28px] font-bold leading-tight">FN OS 로그인</h1>
        <div className="mt-2 space-y-1 text-sm font-medium text-gray-500">
          <p>내부 업무 자동화 및 광고/매출 관리 시스템입니다.</p>
          <p>관리자 전용 서비스입니다.</p>
          <p>로그인이 필요합니다.</p>
        </div>

        <label className="mt-8 block text-sm font-semibold text-gray-700" htmlFor="password">
          비밀번호
        </label>
        <input
          id="password"
          className="mt-2 h-10 w-full rounded-lg border border-gray-300 bg-white px-3 text-base font-medium outline-none focus:border-[#ff6a00] focus:ring-2 focus:ring-orange-100"
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          autoFocus
          required
        />

        <button
          type="submit"
          className="mt-5 h-10 w-full rounded-lg bg-[#ff6a00] text-sm font-semibold text-white shadow-sm shadow-orange-100 hover:bg-[#ea580c] disabled:opacity-60"
          disabled={loading}
        >
          {"들어가기"}
        </button>
      </form>
    </main>
  );
}

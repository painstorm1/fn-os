"use client";

import Image from "next/image";
import { FormEvent, useState } from "react";

export default function LoginPage() {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError("");

    const response = await fetch("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });

    setLoading(false);
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      setError(data.error || "로그인에 실패했습니다.");
      return;
    }

    const params = new URLSearchParams(window.location.search);
    window.location.href = params.get("next") || "/";
  }

  return (
    <main className="grid min-h-screen place-items-center bg-[#f6f7f9] px-5 text-slate-950">
      <form onSubmit={submit} className="w-full max-w-[420px] rounded-md border border-slate-200 bg-white p-8 shadow-sm">
        <Image src="/fn-logo.jpg" alt="F&" width={96} height={96} className="mb-6 object-contain" priority />
        <h1 className="text-2xl font-black">FN OS 로그인</h1>
        <p className="mt-2 text-sm font-semibold text-slate-500">브랜드 운영 대시보드에 접속합니다.</p>

        <label className="mt-8 block text-sm font-black text-slate-700" htmlFor="password">
          비밀번호
        </label>
        <input
          id="password"
          className="mt-2 h-11 w-full rounded-md border border-slate-300 px-3 text-base font-bold outline-orange-400"
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          autoFocus
          required
        />

        {error && <p className="mt-3 rounded-md bg-rose-50 px-3 py-2 text-sm font-bold text-rose-600">{error}</p>}

        <button
          type="submit"
          className="mt-5 h-11 w-full rounded-md bg-orange-500 text-sm font-black text-white shadow-sm shadow-orange-200 disabled:opacity-60"
          disabled={loading}
        >
          {loading ? "확인 중..." : "들어가기"}
        </button>
      </form>
    </main>
  );
}

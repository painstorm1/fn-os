"use client";

import Image from "next/image";
import { FormEvent, useState } from "react";
import { ActionButton, InlineNotice, Input } from "@/components/fn-ui";

export default function LoginPage() {
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setLoading(true);

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
        <Input
          id="password"
          className="mt-2 text-base"
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          autoFocus
          required
        />

        {error && <InlineNotice tone="danger" className="mt-4">{error}</InlineNotice>}

        <ActionButton type="submit" className="mt-5 w-full" disabled={loading}>
          {loading ? "로그인 중..." : "들어가기"}
        </ActionButton>
      </form>
    </main>
  );
}

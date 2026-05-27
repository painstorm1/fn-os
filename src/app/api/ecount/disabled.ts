import { NextResponse } from "next/server";

export function disabledEcountResponse() {
  return NextResponse.json(
    {
      ok: false,
      disabled: true,
      message: "이카운트 연동은 비활성화되었습니다. FN OS 자체 DB API를 사용하세요.",
      replacement: "/api/fnos",
    },
    { status: 410 },
  );
}

export const GET = disabledEcountResponse;
export const POST = disabledEcountResponse;

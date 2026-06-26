import { CoupangChannelAdapter } from "@/lib/channels/coupang";
import { ElevenstChannelAdapter } from "@/lib/channels/elevenst";
import { NaverChannelAdapter } from "@/lib/channels/naver";
import type { SalesChannelAdapter } from "@/lib/channels/common/types";

type AnyRecord = Record<string, unknown>;

function text(value: unknown) {
  return String(value ?? "").trim();
}

export const ONLINE_ORDER_ADAPTERS: Record<string, SalesChannelAdapter> = {
  NAVER: new NaverChannelAdapter(),
  COUPANG: new CoupangChannelAdapter(),
  ELEVENST: new ElevenstChannelAdapter(),
};

export const ONLINE_ORDER_UNSUPPORTED_MESSAGE = "자동수집 어댑터 미지원";

export function onlineOrderAdapterCodeForChannel(channel: AnyRecord) {
  const code = text(channel.channel_code).toUpperCase();
  const name = text(channel.channel_name).toUpperCase();
  const haystack = `${code} ${name}`;
  if (code === "NAVER" || code.startsWith("NAVER_") || /NAVER|네이버|스마트스토어|SMARTSTORE/.test(haystack)) return "NAVER";
  if (code === "COUPANG" || code.startsWith("COUPANG_") || /COUPANG|쿠팡|WING/.test(haystack)) return "COUPANG";
  if (code === "ELEVENST" || code === "11ST" || code.startsWith("ELEVENST_") || /11ST|11번가|십일번가|ELEVEN/.test(haystack)) return "ELEVENST";
  return code;
}

export function onlineOrderAdapterForChannel(channel: AnyRecord) {
  return ONLINE_ORDER_ADAPTERS[onlineOrderAdapterCodeForChannel(channel)] || null;
}

export function isOnlineOrderAdapterSupported(channel: AnyRecord) {
  return Boolean(onlineOrderAdapterForChannel(channel));
}

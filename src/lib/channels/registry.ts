import { CoupangChannelAdapter } from "@/lib/channels/coupang";
import { ElevenstChannelAdapter } from "@/lib/channels/elevenst";

import { LotteonChannelAdapter } from "@/lib/channels/lotteon";
import { NaverChannelAdapter } from "@/lib/channels/naver";
import { SsgChannelAdapter } from "@/lib/channels/ssg";

import { TossChannelAdapter } from "@/lib/channels/toss";
import type { SalesChannelAdapter } from "@/lib/channels/common/types";

type AnyRecord = Record<string, unknown>;

function text(value: unknown) {
  return String(value ?? "").trim();
}

export const ONLINE_ORDER_ADAPTERS: Record<string, SalesChannelAdapter> = {
  NAVER: new NaverChannelAdapter(),
  COUPANG: new CoupangChannelAdapter(),
  ELEVENST: new ElevenstChannelAdapter(),
  SSG: new SsgChannelAdapter(),
  LOTTEON: new LotteonChannelAdapter(),
  TOSS: new TossChannelAdapter(),
};

export const ONLINE_ORDER_UNSUPPORTED_MESSAGE = "자동수집 어댑터 미지원";

export function onlineOrderAdapterCodeForChannel(channel: AnyRecord) {
  const code = text(channel.channel_code).toUpperCase();
  const name = text(channel.channel_name).toUpperCase();
  const haystack = `${code} ${name}`;
  if (code === "NAVER" || code.startsWith("NAVER_") || /NAVER|네이버|스마트스토어|SMARTSTORE/.test(haystack)) return "NAVER";
  if (code === "COUPANG" || code.startsWith("COUPANG_") || /COUPANG|쿠팡|WING/.test(haystack)) return "COUPANG";
  if (code === "ELEVENST" || code === "11ST" || code.startsWith("ELEVENST_") || /11ST|11번가|십일번가|ELEVEN/.test(haystack)) return "ELEVENST";
  if (code === "SSG" || code.startsWith("SSG_") || /SSG|신세계|쓱/.test(haystack)) return "SSG";
  if (code === "ESM" || code === "GMARKET" || code === "AUCTION" || /ESM|G마켓|지마켓|옥션|AUCTION|GMARKET/.test(haystack)) return "ESM";
  if (code === "LOTTEON" || code === "LOTTE" || /롯데ON|롯데온|LOTTEON|LOTTE/.test(haystack)) return "LOTTEON";
  if (code === "KAKAO" || code === "TALKSTORE" || /카카오|톡스토어|KAKAO|TALKSTORE/.test(haystack)) return "KAKAO";
  if (code === "TODAYHOUSE" || code === "OHOU" || /오늘의\s*집|OHOU|O\.RORA|ORORA|TODAYHOUSE/.test(haystack)) return "TODAYHOUSE";
  if (code === "TOSS" || /토스|TOSS/.test(haystack)) return "TOSS";
  return code;
}

export function onlineOrderAdapterForChannel(channel: AnyRecord) {
  return ONLINE_ORDER_ADAPTERS[onlineOrderAdapterCodeForChannel(channel)] || null;
}

export function isOnlineOrderAdapterSupported(channel: AnyRecord) {
  return Boolean(onlineOrderAdapterForChannel(channel));
}

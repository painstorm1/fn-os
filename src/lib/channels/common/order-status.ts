import type { NormalizedOrder } from "./types";

export type CollectableOnlineOrderStage = "신규주문" | "주문확인";

function statusText(value: unknown) {
  return String(value ?? "").trim();
}

function compactStatus(value: unknown) {
  return statusText(value).replace(/[\s_()/.-]+/g, "").toUpperCase();
}

function includesAny(value: string, patterns: string[]) {
  return patterns.some((pattern) => value.includes(pattern));
}

const excludedStatusPatterns = [
  "DISPATCHED",
  "DELIVERING",
  "DELIVERED",
  "PURCHASEDECIDED",
  "CANCEL",
  "RETURN",
  "EXCHANGE",
  "COLLECTING",
  "COLLECTDONE",
  "배송중",
  "배송완료",
  "구매확정",
  "발송처리",
  "발송완료",
  "출고완료",
  "취소",
  "반품",
  "교환",
];

const newOrderStatusPatterns = [
  "NOTYET",
  "NOTYETPLACE",
  "NOTYETPLACEORDER",
  "PAYED",
  "PAID",
  "PAYMENTCOMPLETED",
  "PAYMENTCOMPLETE",
  "ORDERPAID",
  "NEW",
  "NEWORDER",
  "결제완료",
  "신규주문발주전",
  "발주전",
  "신규주문",
];

const confirmedOrderStatusPatterns = [
  "PLACEORDEROK",
  "PLACEPRODUCTORDER",
  "PLACEORDER",
  "ORDERCONFIRMED",
  "CONFIRMED",
  "READYTOSHIP",
  "READYFORDISPATCH",
  "READYFORDELIVERY",
  "WAITINGDELIVERY",
  "WAITINGSHIPMENT",
  "발주후",
  "발주확인",
  "주문확인",
  "발송대기",
  "배송준비",
  "출고대기",
];

const exactNewStatuses = new Set(["NOTYET", "NOTYETPLACE", "NOTYETPLACEORDER"]);
const exactConfirmedStatuses = new Set(["OK", "PLACEORDEROK"]);

export function collectableOnlineOrderStage(status: unknown): CollectableOnlineOrderStage | "" {
  const compact = compactStatus(status);
  if (!compact) return "";
  if (includesAny(compact, excludedStatusPatterns)) return "";
  if (exactConfirmedStatuses.has(compact) || includesAny(compact, confirmedOrderStatusPatterns)) return "주문확인";
  if (exactNewStatuses.has(compact) || includesAny(compact, newOrderStatusPatterns)) return "신규주문";
  return "";
}

export function normalizeCollectableOnlineOrders<T extends NormalizedOrder>(orders: T[]) {
  return orders.flatMap((order) => {
    let orderStage = collectableOnlineOrderStage(order.orderStatus);
    const items = order.items.filter((item) => {
      const itemStatus = statusText((item.raw as { productOrder?: { productOrderStatus?: unknown; orderStatus?: unknown } } | undefined)?.productOrder?.productOrderStatus)
        || statusText((item.raw as { productOrder?: { productOrderStatus?: unknown; orderStatus?: unknown } } | undefined)?.productOrder?.orderStatus)
        || statusText((item.raw as { productOrderStatus?: unknown; orderStatus?: unknown } | undefined)?.productOrderStatus)
        || statusText((item.raw as { productOrderStatus?: unknown; orderStatus?: unknown } | undefined)?.orderStatus)
        || order.orderStatus;
      const itemStage = collectableOnlineOrderStage(itemStatus);
      if (!orderStage && itemStage) orderStage = itemStage;
      return Boolean(itemStage);
    });
    if (!orderStage || !items.length) return [];
    return [{ ...order, orderStatus: orderStage, items }];
  });
}

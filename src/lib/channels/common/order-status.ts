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
  "ACCEPT",
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

export function collectableOnlineOrderStage(status: unknown, placeOrderStatus?: unknown): CollectableOnlineOrderStage | "" {
  const compact = compactStatus(status);
  if (includesAny(compact, excludedStatusPatterns)) return "";
  const compactPlaceOrder = compactStatus(placeOrderStatus);
  if (exactConfirmedStatuses.has(compactPlaceOrder)) return "주문확인";
  if (exactNewStatuses.has(compactPlaceOrder)) return "신규주문";
  if (!compact) return "";
  if (exactConfirmedStatuses.has(compact) || includesAny(compact, confirmedOrderStatusPatterns)) return "주문확인";
  if (exactNewStatuses.has(compact) || includesAny(compact, newOrderStatusPatterns)) return "신규주문";
  return "";
}

export function normalizeCollectableOnlineOrders<T extends NormalizedOrder>(orders: T[]) {
  return orders.flatMap((order) => {
    let orderStage = collectableOnlineOrderStage(order.orderStatus);
    const items = order.items.filter((item) => {
      const raw = item.raw as {
        content?: { productOrder?: { productOrderStatus?: unknown; orderStatus?: unknown; placeOrderStatus?: unknown } };
        productOrder?: { productOrderStatus?: unknown; orderStatus?: unknown; placeOrderStatus?: unknown };
        placeOrderStatus?: unknown;
        __fnosPlaceOrderStatusType?: unknown;
      } | undefined;
      const rawProductOrder = raw?.productOrder || raw?.content?.productOrder;
      const itemPlaceOrderStatus = rawProductOrder?.placeOrderStatus || raw?.placeOrderStatus || raw?.__fnosPlaceOrderStatusType;
      const itemStatus = statusText(rawProductOrder?.productOrderStatus)
        || statusText(rawProductOrder?.orderStatus)
        || statusText((item.raw as { productOrderStatus?: unknown; orderStatus?: unknown } | undefined)?.productOrderStatus)
        || statusText((item.raw as { productOrderStatus?: unknown; orderStatus?: unknown } | undefined)?.orderStatus)
        || order.orderStatus;
      const itemStage = collectableOnlineOrderStage(itemStatus, itemPlaceOrderStatus);
      if (itemStage) orderStage = itemStage;
      return Boolean(itemStage);
    });
    if (!orderStage || !items.length) return [];
    return [{ ...order, orderStatus: orderStage, items }];
  });
}

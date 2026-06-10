export type NormalizedOrderItem = {
  channelProductCode?: string;
  channelOptionCode?: string;
  channelProductName: string;
  channelOptionName?: string;
  sku?: string;
  qty: number;
  salesAmount?: number;
  settlementAmount?: number;
  raw?: unknown;
};

export type NormalizedOrder = {
  channelCode: string;
  channelName: string;
  customerCode?: string;
  customerName?: string;
  orderNo: string;
  bundleOrderNo?: string;
  orderDate?: string;
  orderStatus?: string;
  receiverName?: string;
  phone1?: string;
  phone2?: string;
  zipcode?: string;
  address?: string;
  deliveryMessage?: string;
  items: NormalizedOrderItem[];
  raw?: unknown;
};

export type ChannelResult<T> = {
  ok: boolean;
  data?: T;
  message?: string;
  error?: string;
};

export interface SalesChannelAdapter {
  collectOrders(params: Record<string, unknown>): Promise<ChannelResult<NormalizedOrder[]>>;
  uploadTracking?(params: Record<string, unknown>): Promise<ChannelResult<unknown>>;
  fetchProducts?(params: Record<string, unknown>): Promise<ChannelResult<unknown>>;
}

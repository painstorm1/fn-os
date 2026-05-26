import type { ChannelResult, NormalizedOrder, SalesChannelAdapter } from "../common/types";

export class NaverChannelAdapter implements SalesChannelAdapter {
  async collectOrders(): Promise<ChannelResult<NormalizedOrder[]>> {
    return { ok: false, data: [], message: "네이버 주문 API 어댑터는 다음 단계에서 연결합니다." };
  }
}

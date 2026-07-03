# API 연동 쇼핑몰 주문발주/발송처리 플로우 점검 결과 (2026-07-03)

## 범위

11번가 주문진행상황 보강 이후, FNOS에 API 어댑터가 연결되어 있거나 코드가 존재하는 주요 쇼핑몰의 주문발주/주문확인/발송처리 플로우를 API센터 자료와 현재 코드 기준으로 재점검했다.

- 대상: 네이버, 쿠팡, 롯데ON, SSG, 토스, 카카오톡스토어, ESM/지마켓/옥션, 오늘의집, 이지웰/현대 계열
- 안전 기준: 실제 주문확인/발송처리/송장등록 API는 호출하지 않았다. 공개 문서, 엔드포인트, 코드 구조, mock fetch 스모크만 확인했다.
- 민감정보: API 키/토큰/시크릿/실주문번호는 기록하지 않았다.

## 확인한 공개/API센터 근거

| 사이트 | 확인 근거 |
|---|---|
| 네이버 | 커머스API 센터 `https://apicenter.commerce.naver.com/docs/commerce-api/current`, 실 API 경로 `/external/v1/pay-order/seller/product-orders`, `/confirm`, `/dispatch` |
| 쿠팡 | 쿠팡 OpenAPI 개발자센터 주문/발주서/송장업로드 계열, 코드상 실 API 경로 `/v2/providers/openapi/apis/api/v4/vendors/{vendorId}/ordersheets/acknowledgement`, `/orders/invoices` |
| 롯데ON | 판매자 OpenAPI 주문/배송 진행상태 변경 계열, 코드상 `deliveryProgressStateList`, `odPrgsStepCd=12/13` 흐름 |
| SSG | SSG Open API `https://eapi.ssgadm.com`, `https://eapi.ssgadm.com/info/shpp/saveWblNo.ssg`, 코드상 `updateOrderSubjectManage.ssg`, `saveWblNo.ssg`, `saveWhOutCompleteProcess.ssg` |
| 토스 | 쇼핑 FEP API 경로 기준 `GET /api/v3/shopping-fep/orders/v2`, `PUT /api/v3/shopping-fep/orders/products/delivery` |
| 카카오톡스토어 | 카카오 쇼핑 주문/배송 API 경로 기준 `/v2/shopping/orders`, `/v1/shopping/order`, `/v1/shopping/orders/deliveries/status/confirm`, `/v1/shopping/orders/deliveries/invoices` |

## 사이트별 판정

| 사이트 | 주문수집 | 주문확인/발주확인 | 발송처리/송장등록 | 이번 처리 |
|---|---:|---:|---:|---|
| 11번가 | 지원 | 외부 mutation 미확정 | 외부 mutation 미확정 | 이전 배포에서 `complete`, `packaging`, optional `shipping` 주문진행상황 수집 완료 |
| 네이버 | 지원 | 지원 | 지원 | 페이지네이션/30건 배치 처리 보강, 발송처리 택배사코드/송장번호 필수 검증 강화 |
| 쿠팡 | 지원 | 지원 | 지원 | 기존 구현 유지. `shipmentBoxId`, `orderId`, `vendorItemId`, 송장번호가 필요하므로 실제 행 식별자 누락 여부만 운영 검증 필요 |
| 롯데ON | 지원 | 지원 | 지원 | 기존 구현 유지. `odPrgsStepCd=12` 주문확인, `13` 발송완료 흐름 확인 |
| SSG | 지원 | 지원 | 지원 | CJ대한통운 기본 `delicoVenId`를 SSG 문서값 `0000033011`로 수정 |
| 토스 | 지원 | 미확인/별도 자료 필요 | 지원 | 주문수집 cursor 페이지네이션 추가, 발송처리 adapter 추가 |
| 카카오톡스토어 | 지원 | 지원 | 지원 | 주문수집/주문확인/송장등록 adapter 보강 |
| ESM/지마켓/옥션 | 미설치/비활성 | 미설치 | 미설치 | API 승인/문서 확보 전까지 수동 처리 유지 |
| 오늘의집 | 미설치/비활성 | 미설치 | 미설치 | 파트너/솔루션 승인형으로 판단, 수동 처리 유지 |
| 이지웰/현대 계열 | 미설치/비활성 | 미설치 | 미설치 | 공개 self-serve API 확인 전까지 수동 처리 유지 |

## 구현 변경 요약

### `src/lib/channels/naver/index.ts`

- 주문수집 `product-orders` 조회를 1페이지만 보던 구조에서 최대 100페이지까지 순회하도록 보강했다.
- `confirmOrders`와 `dispatchOrders`를 네이버 API 단위에 맞춰 30건 단위 batch로 호출하게 수정했다.
- 발송처리에서 임의로 송장번호의 숫자 외 문자를 제거하지 않도록 변경했다.
- 발송처리는 `productOrderId`, `deliveryCompanyCode`, `trackingNumber`가 모두 있는 행만 보낸다.

### `src/lib/channels/ssg/index.ts`

- `CJGLS`/`CJ` 기본 매핑을 SSG 문서에서 확인한 CJ대한통운 `delicoVenId=0000033011`로 수정했다.

### `src/lib/channels/toss/index.ts`

- 주문수집 결과 탐색 기준에 `orderProductId`를 추가했다.
- `nextCursor` 기반 페이지네이션을 추가했다.
- `dispatchOrders`를 추가해 `PUT /api/v3/shopping-fep/orders/products/delivery`로 `orderProductId`, `deliveryCompany`, `trackingNumber`를 전송할 수 있게 했다.

### `src/lib/channels/kakao/index.ts`

- 주문 목록/주문 상세 수집 흐름을 보강했다.
- 주문확인 adapter를 추가했다.
- 송장등록/발송처리 adapter를 추가했다.
- 기본 경로는 설정값으로 override 가능하게 유지했다.

## 검증 결과

- TypeScript: `npx tsc --noEmit --pretty false` 통과
- Production build: `npm run build` 통과
- Mock fetch smoke:
  - 네이버 31건 발주확인이 30건 + 1건 두 batch로 나뉘는 것 확인
  - 토스 발송처리 `PUT /api/v3/shopping-fep/orders/products/delivery` 호출 형식 확인
  - 카카오 주문확인 `/v1/shopping/orders/deliveries/status/confirm` 호출 형식 확인
  - SSG `CJGLS`가 `0000033011`로 변환되는 것 확인

## 남은 운영 주의사항

1. 실제 주문확인/발송처리는 고객/배송 상태를 바꾸는 live mutation이므로, 버튼 실행 전 사용자 승인/선택 행 확인이 필요하다.
2. 쿠팡/SSG/롯데ON은 주문수집 row에 플랫폼 고유 식별자(`shipmentBoxId`, `shppNo`, `shppSeq`, `odNo`, `odSeq` 등)가 누락되면 API 호출이 실패할 수 있다.
3. 토스/카카오톡스토어는 공개 경로 기준으로 adapter를 보강했지만, 실제 계정 권한/파트너 승인 여부와 응답 스키마는 첫 운영 계정 dry-run에서 재확인해야 한다.
4. ESM/오늘의집/이지웰은 API센터 자료만으로 self-serve 주문발주/송장 API 연결을 확정하지 못해 수동 처리 대상으로 유지한다.

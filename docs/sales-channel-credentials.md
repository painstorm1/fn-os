# FN OS 쇼핑몰 거래처/주문수집 Credential 구조

## 확정 구조

- `customers.customer_type = 'shopping'`인 거래처를 쇼핑몰 거래처로 사용한다.
- `sales_channels.customer_id`가 쇼핑몰 거래처의 `customers.id`를 참조한다.
- `sales_channels.customer_code`는 UI/엑셀/API 편의를 위한 보조 연결값으로 유지한다.
- 로그인 비밀번호/API secret류는 `sales_channel_credentials`에 암호화 저장한다.
- 주문수집 API는 `sales_channels`에서 채널을 찾고, 필요 시 `sales_channel_credentials`를 복호화해서 사용한다.

## sales_channels 저장 필드

```json
{
  "channel_code": "NAVER",
  "channel_name": "네이버 스마트스토어",
  "channel_type": "api",
  "seller_id": "seller-login-id",
  "customer_id": "customers.id",
  "customer_code": "CUST_NAVER",
  "customer_name": "네이버 스마트스토어",
  "api_enabled": true,
  "api_status": "ready",
  "seller_site_url": "https://sell.smartstore.naver.com/"
}
```

## sales_channel_credentials 저장 필드

지원 credential key:

```text
seller_password
api_client_id
api_client_secret
access_key
secret_key
refresh_token
```

저장 요청:

```json
{
  "channel_code": "NAVER",
  "credentials": {
    "seller_password": "password",
    "api_client_id": "client-id",
    "api_client_secret": "client-secret",
    "access_key": "access-key",
    "secret_key": "secret-key",
    "refresh_token": "refresh-token"
  }
}
```

응답은 기본적으로 원문 secret을 반환하지 않는다.

```json
{
  "ok": true,
  "credentials": [
    {
      "key": "api_client_secret",
      "value": "",
      "hint": "ab****yz",
      "is_secret": true,
      "has_value": true
    }
  ]
}
```

UI의 "보기" 토글처럼 원문이 필요할 때만 `GET /api/fnos/sales-channel-credentials?channel_code=NAVER&reveal=true`를 사용한다.

## API

- `GET /api/fnos/sales-channels`
  - 쇼핑몰 채널 목록
  - credential 원문 없이 `credentials`, `credential_keys`, `credential_count` 포함

- `POST /api/fnos/sales-channels`
  - 채널 저장
  - `customer_id`, `customer_code`, `customer_name` 중 하나로 쇼핑몰 거래처 연결
  - 단건 저장 시 `credentials`를 함께 보내면 credential도 저장

- `GET /api/fnos/sales-channel-credentials?channel_id=...`
  - credential 마스킹 정보 조회

- `GET /api/fnos/sales-channel-credentials?channel_id=...&reveal=true`
  - credential 원문 조회
  - 로그인된 FN OS 세션/API 인증에서만 사용

- `POST /api/fnos/sales-channel-credentials`
  - credential 저장/수정

- `DELETE /api/fnos/sales-channel-credentials`
  - 단일 credential 삭제

## 암호화

- 앱 서버에서 AES-256-GCM으로 암호화한다.
- 암호화 키 우선순위:
  1. `FN_OS_CREDENTIAL_SECRET`
  2. `FN_OS_AUTH_TOKEN`
  3. `FN_OS_PASSWORD`
  4. `SUPABASE_SERVICE_ROLE_KEY`
  5. 로컬 개발 기본값

운영에서는 Vercel에 `FN_OS_CREDENTIAL_SECRET`을 별도로 설정하는 것을 권장한다.

# FN OS 배포 메모

## Vercel 환경변수

FN OS는 자체 Supabase DB를 원장으로 사용한다. Vercel 프로젝트에는 아래 값을 설정한다.

```env
FN_OS_PASSWORD=login-password
FN_OS_AUTH_TOKEN=long-random-cookie-token
FN_OS_API_KEY=vba-or-local-tool-api-key
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
DATABASE_URL=postgresql://...
SLACK_BOT_TOKEN=xoxb-your-slack-bot-token
SLACK_SIGNING_SECRET=your-slack-signing-secret
```

`DATABASE_URL`은 스키마 적용 도구(`npm run db:schema`)에서 사용한다. 운영 API 조회/저장은 `SUPABASE_URL`과 `SUPABASE_SERVICE_ROLE_KEY`를 사용한다.

## 선택 환경변수

수입관리 일부 화면이 아직 별도 수입관리 API를 호출하는 동안만 아래 값을 사용한다. 수입관리 메뉴가 FN OS DB로 완전히 이전되면 제거한다.

```env
NEXT_PUBLIC_IMPORT_API_URL=https://your-import-api.example.com
```

## 배포 흐름

1. GitHub에 FN OS 변경사항을 push한다.
2. Vercel에서 FN OS 저장소를 프로젝트로 import한다.
3. 위 환경변수를 설정한다.
4. Supabase SQL Editor 또는 로컬 `npm run db:schema`로 `schema_sales_inventory.sql`을 적용한다.
5. 배포 후 `/api/dashboard/summary`가 200으로 응답하는지 확인한다.

## 제거된 방향

외부 ERP API 연동용 환경변수와 API 라우트는 더 이상 사용하지 않는다. 주문, 송장, 판매, 구매, 재고, 광고, 비용, 아카이브 데이터는 FN OS 자체 DB 기준으로 확장한다.

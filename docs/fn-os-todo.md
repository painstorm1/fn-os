# FN OS TODO

Last updated: 2026-06-02

## Done In This Pass

- Confirmed the repo is clean against `origin/main` except existing untracked verification images/logs.
- Confirmed `schema_sales_inventory.sql` already includes:
  - `products.product_attribute`
  - `sales_channel_credentials`
  - archive preview fields on `archive_items`
  - `idx_archive_preview_status`
- Confirmed dashboard code is split into:
  - `src/lib/main-dashboard.ts`
  - `src/app/main-dashboard.tsx`
- Confirmed main dashboard cache uses `readInitialCachedJson`, `readCachedJson`, and `cachedJson`.
- Confirmed import dashboard links support:
  - `section=/orders?open=<id>`
  - `section=/orders?date_from=YYYY-MM-DD&date_to=YYYY-MM-DD`
- Added `docs/fn-os-common-architecture.md`.
- Added this TODO tracker.

## P0 - Should Be Done Before More Menu Work

- Review the existing untracked verification artifacts and decide whether to keep, move, or delete them:
  - `accounting-*-verify.png`
  - `archive-*-verify.png`
  - `product-excel-icon-verify.png`
  - `dev-archive-test.log`
  - `dev-inventory-verify.*.log`
- Do not commit those artifacts without explicit confirmation.
- Keep common DB changes centralized through `schema_sales_inventory.sql` or a clearly named migration document.
- Keep deployed production target on `https://fn-os.vercel.app`.

## P1 - Main Dashboard

- Verify real production data on `/api/dashboard/summary`:
  - sales latest date and amount
  - recent 7-day sales
  - monthly sales
  - latest order count
  - inventory risk count
  - ad latest date
  - recent 7-day ad spend / ROAS based on latest ad collection date
  - current-month ad spend / ROAS
  - accounting card spend
  - upcoming fixed costs
  - import recent orders and monthly amounts
- Add a real bank balance source before displaying non-null bank balance.
- Decide whether inquiry count should be a real order/API collection count instead of the current API-enabled channel placeholder.
- If production data looks wrong, fix `src/lib/main-dashboard.ts` only unless a schema issue is confirmed.

## P1 - Common UI

- Expand `docs/fn-ui-design-system.md` with the full modal/component list now captured in `docs/fn-os-common-architecture.md`.
- Audit remaining one-off modal blocks in `src/app/page.tsx` and convert only style/JSX to common modal components.
- Priority modal audit:
  - Import product selection modal
  - Sales / Inventory new customer modal
  - Product create/edit modal
  - Attachment modal
  - Upload modal
  - Delete/confirm modal
- Keep save/search/upload/delete logic unchanged during UI-only modal work.

## P1 - Cache / Responsiveness

- Continue using `src/lib/client-cache.ts` for GET/read paths.
- Check for menu screens that still show blank loading despite cached data being available.
- After writes, invalidate exact affected cache keys and any visible summary cache:
  - `/api/dashboard/summary`
  - `/api/accounting/summary`
  - related `/api/fnos/...` list endpoints
- Avoid cookie-based data caching.

## P2 - URL State

- Audit remaining internal tabs where F5/Back should preserve state.
- Already confirmed:
  - `masterTab`
  - import `tab=materials`
  - import order `open`
  - import order date filters
- Candidate screens to check next:
  - ads date range
  - archive view/filter state
  - accounting sub-view or upload/detail mode if users expect Back/F5 preservation
  - sales/inventory section-specific filters where reload should not reset context

## P2 - Ecount / Legacy Wording Cleanup

- Existing docs still contain old Ecount-era work logs. Keep old logs as history unless the user asks to rewrite them.
- Active UI/API code still contains compatibility labels such as `품목코드(ERP)` and import bridge routes such as `/api/import-erp`.
- Do not remove compatibility fields blindly; many parser/import flows still use them.
- For user-facing new copy, prefer FN OS wording:
  - `품목코드`
  - `품목명`
  - `수입관리`
  - `쇼핑몰 주문`
- Candidate cleanup needs a separate safe pass with visual verification.

## P2 - Schema Documentation

- Convert the large `schema_sales_inventory.sql` into a readable docs summary:
  - master tables
  - transactional tables
  - accounting tables
  - ads tables
  - archive tables
  - import linkage tables
- Keep the SQL file as source of truth; the docs summary should not become a second migration source.

## P3 - Future Functional Work

- Connect real shopping mall order adapters:
  - `src/lib/channels/naver/index.ts`
  - `src/lib/channels/coupang/index.ts`
- Replace dashboard inquiry placeholder count with actual channel/API collection counts.
- Decide how FN OS should store current bank balances.
- Decide whether legacy import-ERP local bridge should remain long term or be replaced by fully native FN OS import APIs.

## Handoff Notes For Other Menu Chats

When another menu chat asks for common DB/API changes, send this first:

```text
이 변경은 공통 DB/API 영향이 있어서 바로 반영하지 않고, 먼저 SQL 변경안, 영향 범위, 기존 데이터 마이그레이션 필요 여부를 정리해서 메인대시보드/DB 설계 채팅에서 확정 후 진행하겠습니다.
```

When a task says "UI only":

```text
DB/API/저장/삭제/검색/업로드 로직은 유지하고, JSX 구조와 공통 컴포넌트/스타일만 정리합니다.
```


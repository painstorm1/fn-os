# FN OS Accounting Ledger Implementation

Last updated: 2026-06-02

## Source Design

Primary design workbook:

- `C:\Users\pains\Downloads\FN_OS_회계비용_설계_DB_v1.xlsx`

Confirmed sheets:

- `00_가이드`
- `01_DB_통합`
- `02_카테고리설정`
- `03_자동분류규칙`
- `04_카드정산캘린더`
- `05_FN메뉴설계`
- `06_대시보드요약`
- `07_업로드로그`
- `08_검토필요`
- `09_공통설정`

## Existing Route Decision

Keep the current FN OS route:

- `/?menu=accounting`

Reason:

- `src/app/page.tsx` already routes `activeSlug === "accounting"` to `AccountingWorkspace`.
- `AccountingRightPanel` is already rendered as a fixed `w-[320px]` right panel.
- Keeping this route avoids introducing a second accounting menu or moving shared layout code.

## Added DB Namespace

New tables use the `accounting_*` prefix to avoid breaking existing `expenses`, `expense_categories`, and `expense_upload_batches`.

Added to `schema_sales_inventory.sql`:

- `accounting_import_batches`
- `accounting_transaction_sources`
- `accounting_categories`
- `accounting_category_rules`
- `accounting_transactions`
- `accounting_review_queue`
- `accounting_card_settlements`
- `accounting_card_settlement_calendar` view
- `accounting_summary` view

Seeded defaults:

- 4 transaction sources:
  - `가온글로벌카드`
  - `국민기업카드`
  - `국민은행 통장`
  - `기업은행 통장`
- Recommended category tree from the workbook prompt.
- First-pass automatic classification rules for:
  - FACEBK / Meta ads
  - Naver wallet / Naver Financial review
  - KCP payment agency review
  - repeated KCP amounts for Ecount/hosting
  - internet-commerce generic names
  - 1688 product purchase
  - bank settlement deposits
  - card payment withdrawals and transfers

## Added Server Module

Added:

- `src/lib/accounting-ledger.ts`

Responsibilities:

- Normalize rows into `accounting_transactions`.
- Preserve raw columns in `raw_json`.
- Preserve user-provided category columns as `existing_category_*`.
- Create `dedupe_key`.
- Apply `accounting_category_rules`.
- Route ambiguous rows to `accounting_review_queue`.
- Rebuild `accounting_card_settlements`.
- Summarize income, expense, net profit, bank cashflow, card settlement due, and review count.

Important accounting safeguards:

- Card usage is treated as profit/loss expense at transaction date.
- Bank card payment withdrawal is `card_payment` and should not affect profit/loss.
- Transfers are separated from profit/loss.
- Foreign transactions keep `foreign_amount`; `amount_krw` is left null when no FX rate exists.

## Added API

New endpoints:

- `POST /api/accounting/ledger/parse`
  - Parse uploaded files and preview normalized/classified rows without saving.
- `POST /api/accounting/ledger/upload`
  - Parse and save normalized transactions.
  - Deduplicates by `dedupe_key`.
  - Creates review queue entries.
  - Rebuilds card settlement rows.
- `GET /api/accounting/ledger/summary?from=YYYY-MM-DD&to=YYYY-MM-DD`
  - Summary for dashboard/right panel.
- `GET /api/accounting/ledger/categories`
  - Accounting category tree.
- `GET /api/accounting/ledger/rules`
  - Automatic classification rules.
- `GET /api/accounting/ledger/review`
  - Pending review queue.

## Existing Parser Reuse

Existing file parser:

- `src/lib/accounting-files.ts`

Current profile support already covers:

- `카드이용내역_...가온글로벌카드.xls`
- `승인내역조회_국민기업카드.xls`
- `...국민.xls`
- `거래내역조회_입출식 예금...기업.xlsx`

The new ledger APIs reuse this parser instead of creating a second Excel parser.

## Next UI Connection

The current UI still uses older endpoints:

- `/api/accounting/summary`
- `/api/accounting/upload`
- `/api/accounting/files/parse`

Next UI pass should switch or add calls to:

- `/api/accounting/ledger/summary`
- `/api/accounting/ledger/parse`
- `/api/accounting/ledger/upload`

Recommended tab mapping:

- `회계/비용 대시보드`
- `거래 DB`
- `업로드`
- `카드 정산`
- `카테고리 설정`
- `자동분류 규칙`
- `검토필요`

Right panel should use `ledger/summary` and keep width `320px`.

## User Confirmation Needed

- `국민기업카드` card limit is blank in the workbook. Confirm if it should be added.
- Confirm whether old `expenses` uploads should continue in parallel or be migrated into `accounting_transactions`.
- Confirm whether `이카운트` should remain as a category label under software costs or be renamed after legacy wording cleanup.
- Confirm production DB migration timing. The new APIs need `schema_sales_inventory.sql` rerun in Supabase before use.

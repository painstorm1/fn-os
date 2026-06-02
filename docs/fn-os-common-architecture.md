# FN OS Common Architecture

Last updated: 2026-06-02

This document is the current shared baseline for FN OS dashboard, common DB/API, common UI, cache, and navigation behavior.

## Direction

FN OS uses its own database as the operating source of truth.

- Sales, orders, shipments, purchases, inventory, import, ads, accounting, and archive data should flow into FN OS DB.
- Ecount/ERP compatibility fields may remain for import compatibility, but new UX copy should prefer FN OS wording.
- Do not add common DB changes directly from a menu-specific task. First document the proposed SQL, affected screens, and migration risk.

## Main Menus

- Main dashboard
- Sales / Inventory
- Import management
- Ads analysis
- Accounting / Cost
- Archive

## Core Tables

### Products

- `products` is the FN OS item master.
- The item code should be treated as `product_code = sku = prod_cd` where compatibility requires multiple fields.
- Amounts are displayed and calculated as VAT-included unless a task explicitly says otherwise.
- `product_attribute` is the canonical item attribute field.

Allowed `product_attribute` values:

- `plain`: normal item
- `set`: SET item
- `rg`: RG item

Confirmed schema support:

- `products.product_attribute`
- `products_product_attribute_check`
- `idx_products_product_attribute`
- `[NG]` product names are normalized toward `[SET]`.

Import linkage should be decided by import-product-to-FN-item link tables, not by `product_attribute`.

### Shopping Mall Channels And Credentials

- Shopping mall partners are managed through `customers`.
- `customers.customer_type = 'shopping'` identifies shopping mall customers.
- `sales_channels.customer_id` links a channel to the customer row.
- Secret credentials must not be stored in plain text.
- `sales_channel_credentials` stores encrypted credentials.
- Production should use `FN_OS_CREDENTIAL_SECRET`.

Related API documents:

- `docs/sales-channel-credentials.md`

### Archive Preview

Confirmed archive preview fields on `archive_items`:

- `original_url`
- `description`
- `preview_image_url`
- `preview_status`
- `preview_error`
- `preview_generated_at`

Confirmed index:

- `idx_archive_preview_status`

The existing `category_id + archive_categories` structure remains canonical. Do not add a duplicate `category` column.

## Main Dashboard Data Rules

Dashboard endpoint:

- `GET /api/dashboard/summary`

Implementation:

- `src/lib/main-dashboard.ts`
- `src/app/main-dashboard.tsx`

Sales / inventory section:

- Latest sales date amount
- Recent 7-day sales
- Current-month sales
- Latest order count
- Inventory risk count
- Inquiry/API-enabled channel count

Ads section:

- Latest collected ad date is the right edge for the 7-day chart.
- Recent 7-day ad spend and ROAS are based on the latest collected ad date, not today's date.
- Current-month ad spend and ROAS remain month-to-date by current KST month.

Accounting / cost section:

- Current-month card spend if card rows exist.
- Otherwise current-month expense total fallback.
- Bank balance is currently not connected and should remain `null` until a real source is confirmed.
- Upcoming fixed costs use `customer_payables.due_date` within 3 days.

Import section:

- Recent orders are sorted by actual import order date descending.
- Recent order links should open the import order list with that order expanded.
- Monthly amounts are shown as a text list, latest month first.
- Monthly links should navigate to import order list with `date_from` / `date_to`.

## Client Cache Rules

Shared client cache:

- `src/lib/client-cache.ts`

Use for GET/read-heavy surfaces:

- `readInitialCachedJson`
- `readCachedJson`
- `cachedJson`
- `invalidateClientCache`

Default behavior:

- Render cached data immediately when available.
- Refresh in the background.
- Invalidate related cache keys after writes/uploads/deletes.
- Do not cache DB data in cookies.

Recommended TTLs:

- Dashboard summary: 45-60 seconds
- Work lists: 1-3 minutes
- Master data: 5-10 minutes
- Ads/accounting summaries: about 5 minutes

## URL State Rules

Preserve important sub-menu state in URL query parameters when F5, Back, or edit-return should keep context.

Confirmed examples:

- Sales / Inventory master tabs use `masterTab`.
- Import products/materials use `tab=products` or `tab=materials`.
- Import orders can use `section=/orders?open=<id>`.
- Import monthly filters can use `section=/orders?date_from=YYYY-MM-DD&date_to=YYYY-MM-DD`.

Do not put short-lived form drafts or temporary typing state into the URL.

## Common UI Rules

Use `src/components/fn-ui.tsx` first:

- `PageHeader`
- `SectionHeader`
- `Card`
- `KpiCard`
- `ActionButton`
- `StatusBadge`
- `FilterBar`
- `EmptyState`
- `ModalShell`
- `ModalHeader`
- `ModalBody`
- `ModalFooter`
- `ModalCloseButton`
- `FormModal`
- `SelectionModal`
- `ConfirmModal`
- `FormField`

UI-only cleanup constraints:

- No DB changes.
- No API changes.
- No business logic changes.
- No save/delete/upload/search behavior changes.
- Markup, shared components, and styling only.

## Modal Rules

Common modal implementation lives in `src/components/fn-ui.tsx`.

Current baseline:

- Overlay: `gray-900/55`
- Modal radius: `rounded-2xl`
- Border: gray-200
- Inputs/selects: 40px height
- Primary button: `#FF6A00`
- Footer buttons: right aligned
- Close button: icon button
- ESC closes modal through `useEscapeToClose`

Prefer:

- `FormModal` for create/edit/upload flows
- `SelectionModal` for search/picker flows
- `ConfirmModal` for destructive confirmation


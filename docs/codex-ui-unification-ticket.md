# Programmer ticket: FNOS web UI consistency unification

## Repository and safety

- Work only in `D:/Orca_work/FN_OS_ui_unification_20260723` on branch `ux/ui-unification-20260723`.
- Base is `origin/main` commit `584225c180874aea1de79165c6e36f59012b3a70`.
- Read `AGENTS.md`, `CLAUDE.md`, and `docs/ui-unification-20260723.md` first.
- This is a local review branch. Do not commit, push, merge, deploy, call mutation APIs, or change production/DB behavior.
- Do not edit environment files, secrets, API routes, DB code, money calculations, order state transitions, collection logic, exports, or keyboard-grid business logic.
- Preserve Korean labels unless consistency requires a small wording correction.
- Do not add dependencies or speculative architecture. Reuse `src/components/fn-ui.tsx`, existing CSS tokens, React, and Next.
- One writer only. Other agents are read-only.

## Goal

Make the current FNOS feel like one coherent app while preserving domain-specific dense tables and shortcuts. Fix shared root causes, not isolated cosmetic symptoms. The user will review the local branch manually and needs an exact menu-by-menu report.

## Required implementation

### 1. Shared UI root (`src/components/fn-ui.tsx`)

Improve the existing primitives without breaking current callers.

- Add reusable `Input`, `Select`, `Textarea`, `Checkbox`, `Tabs`, `TableShell`, `InlineNotice`, and `LoadingState` primitives using existing classes/tokens. Keep APIs small.
- Keep `ActionButton` backward compatible.
- Make `FormModal` and `SelectionModal` proper accessible dialogs:
  - `role="dialog"`, `aria-modal="true"`, generated IDs linking title and optional description.
  - Focus first sensible control (respect existing `autoFocus`), trap Tab/Shift+Tab only in top modal, Escape closes only top modal, restore prior focus on close.
  - Lock body scrolling while one or more modals are open; nested modals must not unlock early.
  - Add optional `bodyClassName`, `headerClassName`, `footerClassName` only if needed to migrate the large sheet modals.
  - Keep current `size` values and add one screen-wide size only if needed for the 1500px sales sheets.
- Add one common non-blocking notice path (`notify` + mounted host, or an equivalently small existing-pattern solution) with accessible live region, manual close, and bounded queue/auto-dismiss. Do not monkeypatch browser APIs.

### 2. Global CSS (`src/app/globals.css`)

- Make keyboard focus visible and consistent for buttons, links, inputs, selects, textareas, and custom tab controls.
- Normalize checkbox size/accent and disabled/cursor behavior without breaking hidden peer-toggle inputs.
- Respect `prefers-reduced-motion`.
- Reuse existing color/radius/spacing tokens; do not introduce a new visual brand or theme.

### 3. App shell and navigation (`src/app/page.tsx`)

- Add a common workspace top bar showing current main menu and current submenu.
- Make the left sidebar available below `lg` through a keyboard-accessible mobile menu button, overlay, and drawer. Closing by overlay, Escape, or successful navigation must work. Desktop layout must remain familiar.
- Add `aria-current` to active links and `aria-expanded`/`aria-controls` to expandable groups.
- Preserve normal link semantics: Ctrl/Meta click, middle click, and open-in-new-tab must continue to work. Do not unconditionally prevent default on `Link`.
- Keep existing URL query parameters as the route/state source. Do not change API or business state.
- Replace dynamic/Suspense blank fallbacks with `LoadingState`.
- Mount the common notice host once in the app shell.

### 4. Menu-specific integration

#### Dashboard (`src/app/main-dashboard.tsx`)
- Use `PageHeader` with a concise description so its hierarchy matches the other primary menus.
- Use common loading/error/empty feedback where the current screen is blank or bespoke.
- Preserve all cards, chart calculations, cache behavior, and API calls.

#### Import management (`src/app/page.tsx`)
- Replace obvious blank loading branches (such as empty Panel content) with common loading feedback.
- Rely on the shared modal fix for order/product/attachment dialogs.
- Do not change order stage/date logic, save/delete/API behavior, or current URL structure.

#### Sales/inventory (`src/app/page.tsx`)
- Migrate the three CSS checkbox/peer large overlays (`송장 엑셀`, `FN판매입력`, `FN구매입력`) to real React state plus `SelectionModal` (or the shared dialog shell). Preserve every existing grid, selection, export, save, and close action.
- Replace their label-as-button triggers/closers with semantic buttons.
- Keep F1–F4 shortcuts, spreadsheet selection, copy/paste, order status logic, and all mutation handlers unchanged.
- Keep the existing fixed sales save toast behavior but route its markup through the common notice primitive if this can be done without changing timing; otherwise retain it and make accessibility/style consistent.

#### Ads (`src/app/page.tsx`)
- Add a useful `PageHeader` description and use common notice/error styling for existing top-level errors/messages when low-risk.
- Preserve required reporting metrics, date URL state, upload logic, charts, and right panel.

#### Accounting (`src/app/page.tsx`)
- Replace the `통장 내역`/`카드 내역` bespoke segmented buttons with shared `Tabs` while preserving reset behavior.
- Wrap the adjacent filter controls in the shared filter pattern when it does not change layout or values.
- Do not change amounts, period calculations, ledger modes, exports, or API calls.

#### Automation (`src/app/automation-center.tsx`)
- Migrate its remaining obvious bespoke buttons/inputs/status feedback to shared primitives where behavior is identical.
- Preserve job CRUD and run behavior.

#### Settings (`src/app/page.tsx`)
- Replace the top `회사정보`/`계정정보`/`비밀번호 변경` bespoke tab group with shared `Tabs`, preserving URL navigation and password-modal behavior.
- Do not weaken or invent auth. Do not touch the localStorage personnel/admin authorization architecture in this UI ticket; document it as a separate server-auth risk.

#### Login (`src/app/login/page.tsx`)
- Use shared input/button/inline notice styling with accessible error live region.
- Preserve the POST, cookie flow, and redirect behavior.

### 5. Feedback migration boundary

- Do not attempt a risky async rewrite of all 61 synchronous `window.confirm` callers.
- Do not globally replace 147 alerts unless each caller remains behaviorally equivalent. Prefer adding the common path and migrating a small number of obvious top-level status messages only.
- Record remaining confirm/alert debt accurately in the report; do not claim full removal.

### 6. Documentation

Update `docs/ui-unification-20260723.md` after implementation:

- Change only completed checklist items to `[x]`.
- Add an `실제 수정 내역` section with exact files/components and menu-by-menu visible behavior changes.
- Add an `의도적으로 유지/남은 과제` section for domain differences, right-panel small-screen limitation if not solved, confirm/alert debt, non-semantic row activation, double-click discoverability, and personnel auth server boundary.
- Add exact local preview command and URL only after running it.

## Verification required before finishing

The user waived a broad test suite, but the artifact must compile and render.

1. Run `git diff --check`.
2. Run focused type/build validation (`npm run build` is preferred). Do not modify source just to silence unrelated pre-existing warnings without proving relation.
3. Start a local dev or production preview on an unused port and verify `/login` responds and the app route reaches its expected auth boundary without calling mutation APIs.
4. Inspect `git status`, `git diff --stat`, and key diffs.
5. Do not commit.

Finish with a concise report listing modified files, commands and real results, preview URL, and remaining risks. If a requirement is unsafe or blocked, explain and leave it unchecked rather than fabricating completion.

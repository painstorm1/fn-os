# FN OS UI Design System

FN OS uses a clean B2B SaaS style: bright surfaces, thin borders, restrained shadows, readable tables, and orange as the single brand accent.

## Colors

- Primary: `#FF6A00`
- Primary hover: `#EA580C`
- Primary soft background: `#FFF7ED`
- Primary border: `#FED7AA`
- Primary text: `#C2410C`
- Page background: `#F9FAFB`
- Border: `#E5E7EB`
- Text: `#111827`
- Muted text: `#6B7280`

Semantic colors are reserved for status only:

- Success: green
- Warning: amber
- Danger: red
- Info: sky
- Disabled/muted: gray

## Typography

Use Pretendard through the global font stack.

- Page title: 28px, 700, line-height 1.3
- Section title: 22px, 700, line-height 1.35
- Card title: 18px, 600, line-height 1.4
- Body: 14px, 400, line-height 1.6
- Body small: 13px, 400, line-height 1.5
- Caption: 12px, 400, line-height 1.4
- Table header: 12-13px, 600
- Table body: 13px, 400

## Common Components

Use `src/components/fn-ui.tsx` before adding one-off styles.

- `PageHeader`
- `SectionHeader`
- `Card`
- `KpiCard`
- `ActionButton`
- `StatusBadge`
- `FilterBar`
- `EmptyState`
- `ModalShell`
- `FormField`

## Layout

- Main app background: `#F9FAFB`
- Content padding target: 24px
- Section gap target: 20-24px
- Card: white, `1px #E5E7EB` border, 12-16px radius, minimal shadow

Avoid nested cards, repeated boxes around simple controls, and heavy shadow.

## Buttons

- Primary: orange background, white text, 38-40px height, 8px radius
- Secondary: white background, gray border, gray text
- Ghost: transparent, gray text, gray hover
- Danger: red only for destructive actions

## Forms

- Inputs/selects: 38-40px height, 8px radius, gray border
- Focus: orange border with soft orange ring
- Placeholder: gray-400

## Tables

- Shell: white, thin gray border, 12px radius, hidden overflow
- Header: gray-50 background, 12-13px semibold gray text
- Row: 48-52px target height, gray-100 divider
- Hover: very soft orange or gray
- Numeric values: right aligned
- Status values: `StatusBadge`

## Badges

Use `StatusBadge`.

- Base: 24px height, pill radius, 12px text, 500 weight
- Brand-related status can use orange
- Operational status should use semantic colors sparingly

## Rules

- Do not change business logic while applying UI style.
- Do not change DB or API for UI-only work.
- Prefer shared components and CSS variables.
- Use orange as the only brand accent.
- Keep screens operational and dense enough for repeated work.

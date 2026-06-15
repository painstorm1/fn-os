# FN OS Automation Center Roadmap

Last updated: 2026-06-15

## Current State

- FN OS has an Automation Center menu and `automation_jobs` table.
- Jobs can be created, listed, opened, updated, and claimed by a worker.
- Real site automation is intentionally not implemented yet.
- `tools/automation-worker.mjs` is the first Mini PC worker skeleton.

## Next TODO

### P0 - Worker Connection

- Run a one-shot worker test from the Mini PC:
  - `FN_OS_ORIGIN=http://localhost:3000 npm run automation:worker -- --once`
- Confirm a queued dry-run job changes to `success`.
- Confirm a normal queued job changes to `waiting_approval` until a real handler exists.
- Decide the real Mini PC worker folder and runtime:
  - repo tool: `tools/automation-worker.mjs`
  - possible external folder later: `D:\FN_AUTOMATION`

### P1 - Smartstore Orders

- Implement only `collect_smartstore_orders` first.
- Decide whether to use official API first or Playwright/RPA first.
- Define download folder and screenshot folder.
- Store result file URL/path and screenshot URL/path in `automation_jobs`.
- Do not mark real jobs `success` until the downloaded order file is verified.

### P2 - FN OS Import

- Convert downloaded Smartstore order files into the existing online order workspace.
- Reuse existing sales/inventory parsing and mapping logic where possible.
- Keep first version manual-review friendly.

### P3 - Invoice File

- Generate invoice output from verified orders.
- First release should use `waiting_approval` before final file/export.

### P4 - Ads / Accounting / Voice

- Add ads report download after order collection is stable.
- Add accounting report download after ads.
- Add voice CLI last: voice creates FN OS jobs, worker executes jobs.

## Owner Split

### User

- Keep FN OS running and reachable from the Mini PC.
- Choose Mini PC execution location and schedule.
- Provide login/API credentials only when the real Smartstore handler starts.
- Confirm which job types may run automatically and which require approval.

### Codex

- Maintain FN OS job schema, APIs, and UI.
- Build the worker loop and job handlers.
- Add smoke tests for claim/update flows.
- Keep unrelated dirty worktree changes out of commits.

## Worker Notes

- Default FN OS origin is `http://localhost:3000`.
- Override with `FN_OS_ORIGIN`.
- Override worker name with `FN_WORKER_ID`.
- Poll interval defaults to 60 seconds and can be changed with `FN_WORKER_POLL_MS`.
- Use `--once` for smoke tests.
- The skeleton marks `dry_run: true` jobs as `success`.
- Non-dry-run jobs are moved to `waiting_approval` until real handlers are implemented.

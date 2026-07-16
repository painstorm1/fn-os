<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# FNOS AGENTS.md

## Project

This repository is FNOS, the user's business operating system.

Core areas:

- Sales / orders / inventory / products
- Import management
- Advertising analysis
- Accounting / expenses
- Automation center
- Agent/Hermes integrations

## Role

Codex acts as the implementation worker. `fn_cool` is the manager/reviewer/final reporter.

## Required Workflow

1. Check `git status --short` before editing.
2. Locate existing implementation with targeted search.
3. Read surrounding files before patching.
4. Keep changes scoped to the requested task.
5. Do not include unrelated dirty files in commits.
6. Run validation before reporting success.
7. If deployment is required, verify actual deployment evidence.

## Validation

For TypeScript/Next.js changes:

```bash
npx tsc --noEmit --pretty false
npm run build
```

If lint is needed, use direct eslint path checks rather than deprecated Next lint file flags.

For API changes:

- Start local app when safe.
- Call the endpoint.
- Capture HTTP status/body.
- Stop server.
- Verify port is free if a background server was started.

For UI changes:

- Use browser/Playwright/Chrome DevTools verification when possible.
- Do not rely only on source inspection.

## Deployment

Do not call a task deployed unless there is real deployment evidence:

- successful Vercel deployment output
- deployment URL/id
- Vercel dashboard/CLI status for the pushed commit
- safe production probes after deployment evidence

Public app reachability alone is not deployment evidence.

## Approval Boundaries

Never perform these without explicit approval:

- customer/order/payment changes
- shipping confirmation
- invoice/customer message sends
- ad budget/campaign changes
- accounting rule changes
- destructive DB writes
- mass deletes
- storing secrets

## Marketplace / Order Integrations

Marketplace/order work must be batch-tested across all relevant configured channels when the user asks for all sites. Do not push site-by-site testing back to the user unless physical login/CAPTCHA/credential renewal is required.

Use safe dry-run/direct probes when verifying external order APIs.

## Obsidian Logging

Important operational changes should be logged by `fn_cool` in Obsidian. Codex should report enough evidence for logging but should not dump long raw logs into Obsidian.

## Completion Report

Use:

```text
상태:
핵심 결과:
검증:
문제:
다음 액션:
승인 필요 여부:
```

Never say “완료” if the code was only written but not validated.

_Last updated: 2026-07-02_

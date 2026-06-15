# FN OS Automation Control Principles

FN OS Automation Center is the official ledger for actual automation executions only.

## Rules

1. Automation Center is not a chat log, request log, or local runner UI.
2. Slack command, DM, app mention, and thread follow-up integrations are disabled.
3. Human file uploads and normal FN OS operations are not automation logs.
4. A human-triggered automation button records a run only when HA/Hermes actually starts work, with `source=manual_auto`.
5. Cron executions record runs with `source=cron`.
6. Agent-triggered executions record runs with `source=agent`.
7. The executing actor is `agent=hermes` or the concrete agent name.
8. Every real execution starts as `automation_runs.status=running`.
9. Major execution steps append `automation_logs.level=info`.
10. Failures append `automation_logs.level=error` and set `automation_runs.status=failed`.
11. Success updates `automation_runs.status=success` and stores a concise summary.

## Current API

- `POST /api/automation/runs/start`
- `POST /api/automation/runs/:id/log`
- `POST /api/automation/runs/:id/complete`
- `GET /api/automation/runs`
- `GET /api/automation/runs/:id/logs`

Legacy `automation_jobs` and queue endpoints are not part of the current Slack-free automation flow.

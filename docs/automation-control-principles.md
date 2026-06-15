# FN OS Automation Control Principles

FN OS web is the system of record for every automation request, status change, and execution log.

## Rules

1. The command and control plane is the FN OS web service: `https://fn-os.vercel.app/`.
2. Every source, including Slack, manual buttons, cron, and agents, must create or update `automation_jobs`.
3. Execution logs must be written to `automation_logs`.
4. FN OS Automation Center must show Slack, manual, cron, and agent work in one integrated view.
5. Local PC and Hermes/HA logs are only auxiliary diagnostics. The official ledger is FN OS web.
6. Local Hermes/HA must not own a separate UI or local-only job state.
7. Hermes/HA acts as a worker: it claims pending work from FN OS API, runs it, and reports logs/results back to FN OS API.

## Implementation Notes

- Slack agents enqueue work through `POST /api/automation/jobs`.
- Hermes/HA workers claim work through `GET /api/automation/jobs/next?agent=<agent-name>`.
- Workers report progress through `/api/automation/jobs/report-*`.
- Completion callbacks to Slack are derived from FN OS job metadata and are secondary to the FN OS Automation Center record.

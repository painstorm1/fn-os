# FN OS Automation Control Principles

FN OS Automation Center is the official ledger for actual automation executions, not a chat inbox or a local runner UI.

## Rules

1. Slack messages are not recorded as FN OS `automation_jobs`.
2. Slack is an entry point that calls HA/Hermes directly.
3. HA/Hermes interprets Slack commands and runs automation work.
4. FN OS records a run only when HA/Hermes actually starts an automation task.
5. Ping, casual chat, simple questions, and command-parse failures are not recorded in Automation Center.
6. Normal human operations inside FN OS, such as manual file uploads, are not Automation Center logs.
7. HA/Hermes cron executions must create `automation_runs` rows and append `automation_logs`.
8. Slack-triggered HA/Hermes executions must also create `automation_runs` rows and append `automation_logs`.
9. The log actor is HA/Hermes, not Slack.
10. Automation Center shows automation execution history through `automation_runs` and `automation_logs`.

## Implementation Notes

- Slack Agent forwards app mentions, DMs, and slash commands to the configured Hermes command handler.
- Slack Agent must not call `POST /api/automation/jobs`.
- Hermes command handlers call `/api/automation/runs/report-start` when actual execution starts.
- Hermes command handlers call `/api/automation/runs/report-log`, `/api/automation/runs/report-success`, and `/api/automation/runs/report-fail` during execution.
- Legacy `/api/automation/jobs/report-*` endpoints are compatibility wrappers and should store new execution records as runs.
- Queue and claim APIs are kept only for legacy/manual compatibility and are not the Slack-Hermes control path.

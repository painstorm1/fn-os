# FN OS Hermes Slack Agent

Bolt-based Slack listener inspired by `slack-samples/bolt-js-starter-agent`.

Slack is now the entrance to HA/Hermes, not an FN OS job intake. This process receives Slack app mentions or DMs and forwards the command to the configured Hermes command handler. It does not create FN OS `automation_jobs`.

FN OS Automation Center is updated later by Hermes itself, only after a real automation run starts, through `automation_runs` and `automation_logs`.

Required environment variables:

```env
SLACK_BOT_TOKEN=xoxb-...
SLACK_APP_TOKEN=xapp-...
HERMES_COMMAND_WEBHOOK_URL=http://127.0.0.1:8791
```

Optional environment variables:

```env
FNOS_AUTOMATION_AGENT_TOKEN=optional-shared-token-for-hermes-command-handler
SLACK_AGENT_LOG_LEVEL=INFO
```

Run:

```sh
npm run slack:agent
```

Local Hermes command handler:

```sh
python C:\Users\pains\AppData\Local\hermes\profiles\ads-agent\scripts\hermes_command_handler.py
```

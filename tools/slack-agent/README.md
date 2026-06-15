# FN OS Hermes Slack Agent

Bolt-based Slack listener inspired by `slack-samples/bolt-js-starter-agent`.

This process does not run Hermes jobs directly. It only receives Slack app mentions or DMs, creates an FN OS `automation_jobs` row through `POST /api/automation/jobs`, and replies in the Slack thread with the queued job ID. Hermes/HA keeps using pull mode through `GET /api/automation/jobs/next?agent=ads-agent`.

Required environment variables:

```env
SLACK_BOT_TOKEN=xoxb-...
SLACK_APP_TOKEN=xapp-...
FNOS_AUTOMATION_API_BASE=https://fn-os.vercel.app
FNOS_AUTOMATION_AGENT_TOKEN=optional-if-set-on-fnos
```

Run:

```sh
npm run slack:agent
```

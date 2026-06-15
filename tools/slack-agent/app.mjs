import "dotenv/config";

import { App, LogLevel } from "@slack/bolt";
import { parseHermesCommand } from "./command-parser.mjs";
import { createAutomationJob } from "./fnos-client.mjs";

const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  appToken: process.env.SLACK_APP_TOKEN,
  socketMode: true,
  logLevel: process.env.SLACK_AGENT_LOG_LEVEL || LogLevel.INFO,
  ignoreSelf: true,
});

function slackContext(event) {
  return {
    channel_id: event.channel,
    channel_type: event.channel_type,
    user_id: event.user,
    message_ts: event.ts,
    thread_ts: event.thread_ts || event.ts,
  };
}

async function enqueueFromSlack({ client, event, logger, text }) {
  const parsed = parseHermesCommand(text);
  if (!parsed.requested_text) {
    await client.chat.postMessage({
      channel: event.channel,
      thread_ts: event.thread_ts || event.ts,
      text: "어떤 작업을 등록할지 메시지로 알려주세요. 예: `ads collect yesterday`",
    });
    return;
  }

  const job = await createAutomationJob({
    ...parsed,
    requested_by: "slack",
    source: "slack_agent",
    trigger_type: "slack",
    input_json: {
      ...parsed.input_json,
      slack: slackContext(event),
    },
    slack: slackContext(event),
  });

  logger.info(`Created FN OS automation job ${job.id} from Slack event ${event.ts}`);
  await client.chat.postMessage({
    channel: event.channel,
    thread_ts: event.thread_ts || event.ts,
    text: [
      "작업 접수됨.",
      `작업 ID: ${job.id}`,
      `작업: ${job.job_type}`,
      `담당: ${job.assigned_agent || parsed.assigned_agent}`,
      `상태: ${job.status}`,
    ].join("\n"),
  });
}

app.event("app_mention", async ({ client, event, logger }) => {
  try {
    const text = String(event.text || "").replace(/<@[A-Z0-9]+>/g, "").trim();
    await enqueueFromSlack({ client, event, logger, text });
  } catch (error) {
    logger.error(error);
    await client.chat.postMessage({
      channel: event.channel,
      thread_ts: event.thread_ts || event.ts,
      text: `작업 접수 실패: ${error instanceof Error ? error.message : String(error)}`,
    });
  }
});

app.message(async ({ client, event, logger }) => {
  if (event.subtype || event.bot_id) return;
  if (event.channel_type !== "im") return;
  try {
    await enqueueFromSlack({ client, event, logger, text: event.text || "" });
  } catch (error) {
    logger.error(error);
    await client.chat.postMessage({
      channel: event.channel,
      thread_ts: event.thread_ts || event.ts,
      text: `작업 접수 실패: ${error instanceof Error ? error.message : String(error)}`,
    });
  }
});

await app.start();
app.logger.info("FN OS Hermes Slack Agent is running");

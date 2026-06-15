import "dotenv/config";

import { App, LogLevel } from "@slack/bolt";
import { sendHermesCommand } from "./fnos-client.mjs";

const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  appToken: process.env.SLACK_APP_TOKEN,
  socketMode: true,
  logLevel: process.env.SLACK_AGENT_LOG_LEVEL || LogLevel.INFO,
  ignoreSelf: true,
});

function debugLog(label, payload = {}) {
  console.log(
    `[FN OS Slack Agent] ${new Date().toISOString()} ${label}`,
    JSON.stringify(payload),
  );
}

function slackContext(event) {
  return {
    channel_id: event.channel,
    channel_type: event.channel_type,
    user_id: event.user,
    message_ts: event.ts,
    thread_ts: event.thread_ts || event.ts,
  };
}

app.use(async ({ body, next }) => {
  const event = body?.event;
  debugLog("event received", {
    type: event?.type,
    subtype: event?.subtype,
    channel: event?.channel,
    channel_type: event?.channel_type,
    user: event?.user,
    ts: event?.ts,
  });
  await next();
});

async function forwardToHermes({ client, event, logger, text }) {
  debugLog("hermes command requested", {
    channel: event.channel,
    channel_type: event.channel_type,
    user: event.user,
    ts: event.ts,
    text,
  });

  const requestedText = String(text || "").trim();
  if (!requestedText) {
    await client.chat.postMessage({
      channel: event.channel,
      thread_ts: event.thread_ts || event.ts,
      text: "명령을 입력해주세요. 예: `ads collect yesterday`",
    });
    return;
  }

  if (/^ping$/i.test(requestedText)) {
    await client.chat.postMessage({
      channel: event.channel,
      thread_ts: event.thread_ts || event.ts,
      text: "pong",
    });
    return;
  }

  const result = await sendHermesCommand({
    source: "slack",
    requested_by: event.user,
    text: requestedText,
    slack: slackContext(event),
  });

  logger.info(`Forwarded Slack command ${event.ts} to Hermes command handler`);
  debugLog("hermes command accepted", {
    run_id: result.run_id || result.run?.id,
    task_type: result.task_type || result.run?.task_type,
    status: result.status || result.run?.status,
  });
  await client.chat.postMessage({
    channel: event.channel,
    thread_ts: event.thread_ts || event.ts,
    text: result.reply || result.message || "Hermes에 명령을 전달했습니다.",
  });
}

app.event("app_mention", async ({ client, event, logger }) => {
  debugLog("app_mention received", {
    channel: event.channel,
    user: event.user,
    ts: event.ts,
    text: event.text,
  });

  try {
    const text = String(event.text || "").replace(/<@[A-Z0-9]+>/g, "").trim();
    await forwardToHermes({ client, event, logger, text });
  } catch (error) {
    debugLog("app_mention failed", {
      message: error instanceof Error ? error.message : String(error),
    });
    logger.error(error);
    await client.chat.postMessage({
      channel: event.channel,
      thread_ts: event.thread_ts || event.ts,
      text: `Hermes 명령 전달 실패: ${error instanceof Error ? error.message : String(error)}`,
    });
  }
});

app.message(async ({ client, event, logger }) => {
  debugLog("message event received", {
    subtype: event.subtype,
    bot_id: event.bot_id,
    channel: event.channel,
    channel_type: event.channel_type,
    user: event.user,
    ts: event.ts,
    text: event.text,
  });

  if (event.subtype || event.bot_id) {
    debugLog("message ignored", {
      reason: event.subtype ? "subtype" : "bot_id",
      subtype: event.subtype,
      bot_id: event.bot_id,
    });
    return;
  }
  if (event.channel_type !== "im") {
    debugLog("message ignored", {
      reason: "not_im",
      channel_type: event.channel_type,
    });
    return;
  }

  debugLog("message.im received", {
    channel: event.channel,
    user: event.user,
    ts: event.ts,
    text: event.text,
  });

  try {
    await forwardToHermes({ client, event, logger, text: event.text || "" });
  } catch (error) {
    debugLog("message.im failed", {
      message: error instanceof Error ? error.message : String(error),
    });
    logger.error(error);
    await client.chat.postMessage({
      channel: event.channel,
      thread_ts: event.thread_ts || event.ts,
      text: `Hermes 명령 전달 실패: ${error instanceof Error ? error.message : String(error)}`,
    });
  }
});

debugLog("socket mode starting", {
  has_bot_token: Boolean(process.env.SLACK_BOT_TOKEN),
  has_app_token: Boolean(process.env.SLACK_APP_TOKEN),
  hermes_command_webhook_configured: Boolean(process.env.HERMES_COMMAND_WEBHOOK_URL || process.env.HERMES_COMMAND_URL),
});

await app.start();
debugLog("socket mode connected");
app.logger.info("FN OS Hermes Slack Agent is running");

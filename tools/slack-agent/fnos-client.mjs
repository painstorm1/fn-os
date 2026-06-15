const DEFAULT_BASE_URL = "https://fn-os.vercel.app";

function baseUrl() {
  return (process.env.FNOS_AUTOMATION_API_BASE || DEFAULT_BASE_URL).replace(/\/$/, "");
}

function headers() {
  const result = { "Content-Type": "application/json; charset=utf-8" };
  const token = process.env.FNOS_AUTOMATION_AGENT_TOKEN || "";
  if (token) {
    result.Authorization = `Bearer ${token}`;
    result["x-automation-agent-token"] = token;
  }
  return result;
}

export async function createAutomationJob(payload) {
  const response = await fetch(`${baseUrl()}/api/automation/jobs`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify(payload),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data?.ok === false) {
    throw new Error(data?.error || `FN OS automation job create failed: ${response.status}`);
  }
  return data.job;
}

function hermesCommandUrl() {
  return (process.env.HERMES_COMMAND_WEBHOOK_URL || process.env.HERMES_COMMAND_URL || "").trim();
}

export async function sendHermesCommand(payload) {
  const url = hermesCommandUrl();
  if (!url) {
    throw new Error("HERMES_COMMAND_WEBHOOK_URL is not configured.");
  }

  const response = await fetch(url, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify(payload),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data?.ok === false) {
    throw new Error(data?.error || `Hermes command handler failed: ${response.status}`);
  }
  return data;
}

import { createServer } from "node:http";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

const PORT = Number(process.env.FNOS_ONLINE_WORKSPACE_BRIDGE_PORT || 3010);
const WORKSPACE_FILE_PATH = process.env.FNOS_ONLINE_WORKSPACE_PATH || "D:/FN_AUTOMATION/fnos-online-workspace/workspace.json";
const ALLOWED_ORIGIN = process.env.FN_OS_ORIGIN || "https://fn-os.vercel.app";

const corsHeaders = {
  "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
  "Access-Control-Allow-Methods": "GET, PUT, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-FNOS-Local-Bridge",
  "Access-Control-Allow-Private-Network": "true",
};

function sendJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    ...corsHeaders,
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(payload),
    "Cache-Control": "no-store",
  });
  res.end(payload);
}

async function readJsonBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

async function readWorkspaceSnapshot() {
  try {
    const raw = await readFile(WORKSPACE_FILE_PATH, "utf8");
    if (!raw.trim()) return null;
    return JSON.parse(raw);
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

async function saveWorkspaceSnapshot(body) {
  const snapshot = body?.snapshot;
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) {
    return { status: 400, body: { ok: false, error: "snapshot이 필요합니다." } };
  }
  const expectedUpdatedAt = typeof body.expectedUpdatedAt === "string" ? body.expectedUpdatedAt : "";
  const current = await readWorkspaceSnapshot();
  const currentUpdatedAt = typeof current?.updatedAt === "string" ? current.updatedAt : "";
  const currentDayKey = typeof current?.dayKey === "string" ? current.dayKey : "";
  const incomingDayKey = typeof snapshot.dayKey === "string" ? snapshot.dayKey : "";
  const sameDay = Boolean(currentDayKey) && currentDayKey === incomingDayKey;

  if (sameDay && currentUpdatedAt && expectedUpdatedAt !== currentUpdatedAt) {
    return { status: 409, body: { ok: false, conflict: true, snapshot: current, error: "서버에 더 최신 작업공간이 저장되어 있습니다." } };
  }

  const updatedBy = typeof snapshot.updatedBy === "string" && snapshot.updatedBy.trim() ? snapshot.updatedBy.trim().slice(0, 40) : "unknown-client";
  const finalSnapshot = { ...snapshot, updatedAt: new Date().toISOString(), updatedBy };
  await mkdir(path.dirname(WORKSPACE_FILE_PATH), { recursive: true });
  const tempPath = `${WORKSPACE_FILE_PATH}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tempPath, JSON.stringify(finalSnapshot), "utf8");
  await rename(tempPath, WORKSPACE_FILE_PATH);
  return { status: 200, body: { ok: true, snapshot: finalSnapshot } };
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
    if (req.method === "OPTIONS") {
      res.writeHead(204, corsHeaders);
      res.end();
      return;
    }
    if (url.pathname !== "/api/fnos/online-workspace") {
      sendJson(res, 404, { ok: false, error: "not found" });
      return;
    }
    if (req.method === "GET") {
      sendJson(res, 200, { ok: true, snapshot: await readWorkspaceSnapshot() });
      return;
    }
    if (req.method === "PUT" || req.method === "POST") {
      const result = await saveWorkspaceSnapshot(await readJsonBody(req));
      sendJson(res, result.status, result.body);
      return;
    }
    sendJson(res, 405, { ok: false, error: "method not allowed" });
  } catch (error) {
    sendJson(res, 500, { ok: false, error: error instanceof Error ? error.message : "작업공간 브릿지 오류" });
  }
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`FNOS online workspace bridge listening on 0.0.0.0:${PORT}`);
  console.log(`Workspace file: ${WORKSPACE_FILE_PATH}`);
});

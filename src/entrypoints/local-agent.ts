#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { WebSocket } from "ws";
import { loadEnvFile } from "../config/load-env.js";
import { botConfig } from "../config/bot.js";
import { call } from "../application/mcp-client.js";
import { isAllowedRpcMethod } from "../application/rpc-allowlist.js";
import { createReplayGuard } from "../application/replay-guard.js";

await loadEnvFile();

const AGENT_VERSION = "0.1.0";
const MAX_BACKOFF_MS = 30_000;

type DeviceIdentity = { deviceId: string; accessToken: string };

async function loadIdentity(): Promise<DeviceIdentity> {
  const file = path.join(botConfig.deviceDir, "device.json");
  try {
    const raw = JSON.parse(await fs.readFile(file, "utf8"));
    if (typeof raw.deviceId !== "string" || typeof raw.accessToken !== "string") throw new Error("malformed");
    return { deviceId: raw.deviceId, accessToken: raw.accessToken };
  } catch {
    console.error("Локальное устройство не сопряжено.");
    console.error("Откройте Mini App → Подключение → «Подключить компьютер», затем выполните:");
    console.error("  pnpm run pair-device <код из Mini App>");
    process.exit(1);
  }
}

function hubUrl(): string {
  const raw = process.env.AGENT_HUB_URL || botConfig.miniAppUrl;
  if (!raw) throw new Error("Задайте AGENT_HUB_URL (или MINIAPP_URL) — адрес развёрнутого моста Railway.");
  const url = new URL(raw);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.pathname = "/agent/socket";
  url.search = "";
  url.hash = "";
  return url.href;
}

const replayGuard = createReplayGuard();

function log(event: string, fields: Record<string, unknown> = {}) {
  console.log(JSON.stringify({ event, ...fields, ts: new Date().toISOString() }));
}

let stopping = false;

async function handleRpc(ws: WebSocket, msg: { id: string; method: string; params?: Record<string, unknown>; ts: number }) {
  const { id, method, params } = msg;
  const respond = (payload: Record<string, unknown>) => { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "rpc_result", id, ...payload })); };
  if (replayGuard.isReplay(id, Number(msg.ts))) { respond({ ok: false, error: { code: "RPC_REPLAYED" } }); return; }
  if (typeof method !== "string" || !isAllowedRpcMethod(method)) { respond({ ok: false, error: { code: "RPC_METHOD_NOT_ALLOWED" } }); return; }
  const startedAt = Date.now();
  try {
    const result = await call(method, params ?? {});
    respond({ ok: true, result });
    log("rpc_executed", { method, ok: true, durationMs: Date.now() - startedAt });
  } catch (error) {
    respond({ ok: false, error: { code: "RPC_FAILED", message: error instanceof Error ? error.message : String(error) } });
    log("rpc_executed", { method, ok: false, durationMs: Date.now() - startedAt });
  }
}

function connectOnce(identity: DeviceIdentity): Promise<{ authorized: boolean }> {
  return new Promise(resolve => {
    const ws = new WebSocket(hubUrl());
    let authorized = false;
    let heartbeat: NodeJS.Timeout | undefined;

    ws.on("open", () => ws.send(JSON.stringify({ type: "hello", deviceId: identity.deviceId, token: identity.accessToken, agentVersion: AGENT_VERSION })));

    ws.on("message", raw => {
      let msg: any;
      try { msg = JSON.parse(String(raw)); } catch { return; }
      if (msg?.type === "hello_ok") {
        authorized = true;
        console.log(`Подключено к мосту (владелец Telegram ID ${msg.ownerTelegramId}). Ожидаю команды.`);
        heartbeat = setInterval(() => { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "ping", ts: Date.now() })); }, 20_000);
      } else if (msg?.type === "hello_error") {
        console.error(`Сопряжение отклонено мостом: ${msg.code}`);
        if (msg.code === "DEVICE_REVOKED" || msg.code === "DEVICE_UNKNOWN") { stopping = true; console.error("Устройство отозвано или неизвестно. Выполните pnpm run pair-device заново."); }
      } else if (msg?.type === "rpc" && typeof msg.id === "string") {
        void handleRpc(ws, msg);
      }
    });

    ws.on("close", () => { if (heartbeat) clearInterval(heartbeat); resolve({ authorized }); });
    ws.on("error", error => console.error("Ошибка соединения с мостом:", error instanceof Error ? error.message : String(error)));
  });
}

async function main() {
  const identity = await loadIdentity();
  console.log(`Локальный агент РТС ${AGENT_VERSION} запущен. Устройство: ${identity.deviceId.slice(0, 8)}…`);
  process.once("SIGINT", () => { stopping = true; process.exit(0); });
  process.once("SIGTERM", () => { stopping = true; process.exit(0); });

  let backoffMs = 1_000;
  while (!stopping) {
    const { authorized } = await connectOnce(identity);
    if (stopping) break;
    backoffMs = authorized ? 1_000 : Math.min(MAX_BACKOFF_MS, backoffMs * 2);
    console.log(`Соединение с мостом потеряно. Повтор через ${Math.round(backoffMs / 1000)} с…`);
    await delay(backoffMs);
  }
}

await main();

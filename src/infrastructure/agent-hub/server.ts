import { randomUUID } from "node:crypto";
import type { Server as HttpServer } from "node:http";
import { WebSocketServer, WebSocket, type RawData } from "ws";
import { findDevice, touchDevice } from "../persistence/device-store.js";
import { secretMatches } from "../security/pairing.js";
import { isAllowedRpcMethod } from "../../application/rpc-allowlist.js";
import { safeRpcError, sanitizeRpcResult } from "../../application/rpc-safety.js";
import { botConfig } from "../../config/bot.js";

const MAX_PAYLOAD_BYTES = 8 * 1024 * 1024;
const HELLO_TIMEOUT_MS = 10_000;
const HEARTBEAT_TIMEOUT_MS = 60_000;
const DEFAULT_RPC_TIMEOUT_MS = 45_000;
const MAX_PENDING_RPC = 32;

type Pending = { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: NodeJS.Timeout };
type Connection = { ws: WebSocket; deviceId: string; ownerTelegramId: number; lastSeenAt: number; pending: Map<string, Pending> };

const connections = new Map<number, Connection>(); // ownerTelegramId -> single active agent connection
const lastDisconnect = new Map<number, { code: string; at: number }>();
const LAST_DISCONNECT_TTL_MS = 5 * 60_000; // stale reasons stop being shown once this old

function log(event: string, fields: Record<string, unknown> = {}) {
  console.log(JSON.stringify({ event, ...fields, ts: new Date().toISOString() }));
}
function send(ws: WebSocket, value: unknown) {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(value));
}
function rejectAllPending(connection: Connection, code: string) {
  for (const pending of connection.pending.values()) { clearTimeout(pending.timer); pending.reject(new Error(code)); }
  connection.pending.clear();
}
function dropConnection(connection: Connection, code: string) {
  // A connection we close explicitly (revoke, superseded) still fires its own
  // "close" event afterwards with a generic reason; only the first drop for a
  // given connection should decide the recorded reason, so later ones (this
  // connection is no longer the active one) must not clobber it.
  const stillActive = connections.get(connection.ownerTelegramId) === connection;
  if (!stillActive) { rejectAllPending(connection, code); return; }
  connections.delete(connection.ownerTelegramId);
  lastDisconnect.set(connection.ownerTelegramId, { code, at: Date.now() });
  rejectAllPending(connection, code);
}

export function isOwnerConnected(ownerTelegramId: number): boolean {
  return connections.has(ownerTelegramId);
}

/** Why the owner's agent most recently dropped, for a short window — lets the
 * Mini App show "this device was revoked" instead of a generic "offline" when
 * that is in fact why nothing is connected right now. Stale entries (past the
 * TTL, or superseded by a later successful reconnect) are not returned. */
export function lastDisconnectReason(ownerTelegramId: number): string | undefined {
  if (connections.has(ownerTelegramId)) return undefined;
  const entry = lastDisconnect.get(ownerTelegramId);
  if (!entry || Date.now() - entry.at > LAST_DISCONNECT_TTL_MS) return undefined;
  return entry.code;
}

export function connectedDeviceId(ownerTelegramId: number): string | undefined {
  return connections.get(ownerTelegramId)?.deviceId;
}

export function disconnectDevice(deviceId: string, code = "DEVICE_REVOKED") {
  for (const connection of connections.values()) {
    if (connection.deviceId !== deviceId) continue;
    send(connection.ws, { type: "hello_error", code });
    connection.ws.close(4006, code);
    dropConnection(connection, code);
  }
}

export async function sendRpc<T = unknown>(ownerTelegramId: number, method: string, params: Record<string, unknown> = {}, opts: { timeoutMs?: number } = {}): Promise<T> {
  if (!isAllowedRpcMethod(method)) throw new Error("RPC_METHOD_NOT_ALLOWED");
  const connection = connections.get(ownerTelegramId);
  if (!connection) throw new Error("AGENT_OFFLINE");
  if (connection.pending.size >= MAX_PENDING_RPC) throw new Error("AGENT_BUSY");
  const id = randomUUID();
  const timeoutMs = Math.max(1_000, Math.min(120_000, opts.timeoutMs ?? DEFAULT_RPC_TIMEOUT_MS));
  const startedAt = Date.now();
  try {
    const result = await new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => { connection.pending.delete(id); reject(new Error("AGENT_TIMEOUT")); }, timeoutMs);
      connection.pending.set(id, { resolve: value => resolve(value as T), reject, timer });
      send(connection.ws, { type: "rpc", id, ts: Date.now(), method, params });
    });
    log("rpc", { ownerTelegramId, deviceId: connection.deviceId, method, ok: true, durationMs: Date.now() - startedAt });
    return result;
  } catch (error) {
    log("rpc", { ownerTelegramId, deviceId: connection.deviceId, method, ok: false, durationMs: Date.now() - startedAt, errorCode: error instanceof Error ? error.message : "RPC_FAILED" });
    throw error;
  }
}

function handleMessage(connection: Connection, raw: RawData) {
  let msg: any;
  try { msg = JSON.parse(String(raw)); } catch { return; }
  if (msg?.type === "ping") { connection.lastSeenAt = Date.now(); send(connection.ws, { type: "pong", ts: Date.now() }); return; }
  if (msg?.type === "rpc_result" && typeof msg.id === "string") {
    const pending = connection.pending.get(msg.id);
    if (!pending) return; // unknown, already-resolved or replayed id — ignored
    connection.pending.delete(msg.id);
    clearTimeout(pending.timer);
    if (msg.ok === true) pending.resolve(sanitizeRpcResult(msg.result));
    else pending.reject(new Error(safeRpcError(msg?.error).code));
  }
}

async function handleHello(ws: WebSocket, raw: RawData) {
  let msg: any;
  try { msg = JSON.parse(String(raw)); } catch { ws.close(4002, "bad json"); return; }
  if (msg?.type !== "hello" || typeof msg.deviceId !== "string" || typeof msg.token !== "string" || !/^[A-Za-z0-9._:-]{8,128}$/.test(msg.deviceId) || msg.token.length < 1 || msg.token.length > 128) {
    ws.close(4002, "bad hello"); return;
  }
  const device = findDevice(msg.deviceId);
  if (!device) { send(ws, { type: "hello_error", code: "DEVICE_UNKNOWN" }); ws.close(4003, "unknown device"); return; }
  if (!botConfig.rtsAccountOwnerIds.has(device.ownerTelegramId)) { send(ws, { type: "hello_error", code: "OWNER_DISABLED" }); ws.close(4003, "owner disabled"); return; }
  if (device.revokedAt) { send(ws, { type: "hello_error", code: "DEVICE_REVOKED" }); ws.close(4003, "revoked"); return; }
  if (!secretMatches(msg.token, device.tokenHash)) { send(ws, { type: "hello_error", code: "TOKEN_INVALID" }); ws.close(4003, "bad token"); return; }

  const existing = connections.get(device.ownerTelegramId);
  if (existing) { send(existing.ws, { type: "hello_error", code: "SUPERSEDED" }); existing.ws.close(4004, "superseded"); dropConnection(existing, "SUPERSEDED"); }

  const connection: Connection = { ws, deviceId: device.deviceId, ownerTelegramId: device.ownerTelegramId, lastSeenAt: Date.now(), pending: new Map() };
  connections.set(device.ownerTelegramId, connection);
  lastDisconnect.delete(device.ownerTelegramId);
  await touchDevice(device.deviceId);
  send(ws, { type: "hello_ok", ownerTelegramId: device.ownerTelegramId });
  log("agent_connected", { deviceId: device.deviceId, ownerTelegramId: device.ownerTelegramId, agentVersion: device.agentVersion });

  ws.on("message", (data: RawData) => handleMessage(connection, data));
  ws.on("close", () => { dropConnection(connection, "AGENT_DISCONNECTED"); log("agent_disconnected", { deviceId: device.deviceId, ownerTelegramId: device.ownerTelegramId }); });
  ws.on("error", () => {});
}

function sweepStaleConnections() {
  const now = Date.now();
  for (const connection of [...connections.values()]) {
    if (now - connection.lastSeenAt <= HEARTBEAT_TIMEOUT_MS) continue;
    connection.ws.close(4005, "heartbeat timeout");
    dropConnection(connection, "AGENT_TIMEOUT");
    log("agent_stale", { deviceId: connection.deviceId, ownerTelegramId: connection.ownerTelegramId });
  }
}

export function attachAgentHub(server: HttpServer) {
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_PAYLOAD_BYTES });
  server.on("upgrade", (req, socket, head) => {
    const url = new URL(req.url ?? "/", "http://local");
    if (url.pathname !== "/agent/socket") { socket.destroy(); return; }
    wss.handleUpgrade(req, socket, head, ws => wss.emit("connection", ws));
  });
  wss.on("connection", (ws: WebSocket) => {
    const helloTimer = setTimeout(() => ws.close(4001, "hello timeout"), HELLO_TIMEOUT_MS);
    ws.once("message", (raw: RawData) => { clearTimeout(helloTimer); void handleHello(ws, raw); });
    ws.on("error", () => {});
  });
  setInterval(sweepStaleConnections, 15_000).unref();
  return wss;
}

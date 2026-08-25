import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport, getDefaultEnvironment } from "@modelcontextprotocol/sdk/client/stdio.js";
import { botConfig } from "../config/bot.js";
import { sendRpc } from "../infrastructure/agent-hub/server.js";

let client: Client | undefined;
const rtsEnvironment=()=>Object.fromEntries(Object.entries(process.env).filter(([key,value])=>key.startsWith("RTS_")&&value!==undefined)) as Record<string,string>;
export async function mcp() {
  if (client) return client;
  const transport = new StdioClientTransport({ command: botConfig.mcpCommand, args: botConfig.mcpArgs, env:{...getDefaultEnvironment(),...rtsEnvironment()}, stderr: "inherit" });
  client = new Client({ name: "krd-market-telegram", version: "0.1.0" });
  await client.connect(transport); return client;
}
async function callLocal<T>(name: string, args: Record<string, unknown>): Promise<T> {
  const result = await (await mcp()).callTool({ name, arguments: args });
  if (result.isError) throw new Error((result.content as Array<{ text?: string }>).map(x => x.text).filter(Boolean).join("\n"));
  const raw = (result.content as Array<{ type: string; text?: string }>).find(x => x.type === "text")?.text ?? "null";
  return JSON.parse(raw) as T;
}
/** Single entry point used by every interface (Telegram bot, Mini App, monitor).
 * In "local" transport this spawns/reuses the MCP subprocess and its Chromium
 * directly — the historic single-machine setup, and how the local agent itself
 * always operates. In "hub" transport (Railway, no local Chromium) the same call
 * is instead relayed over the authenticated WebSocket channel to the paired
 * local agent belonging to the configured RTS account owner. */
export async function call<T = unknown>(name: string, args: Record<string, unknown> = {}): Promise<T> {
  if (botConfig.rtsTransport === "hub") {
    if (botConfig.rtsAccountOwnerId === undefined) throw new Error("Владелец сессии РТС не настроен");
    return sendRpc<T>(botConfig.rtsAccountOwnerId, name, args);
  }
  return callLocal<T>(name, args);
}
export async function closeMcp() { await client?.close(); client = undefined; }

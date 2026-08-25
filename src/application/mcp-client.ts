import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport, getDefaultEnvironment } from "@modelcontextprotocol/sdk/client/stdio.js";
import { botConfig } from "../config/bot.js";

let client: Client | undefined;
const rtsEnvironment=()=>Object.fromEntries(Object.entries(process.env).filter(([key,value])=>key.startsWith("RTS_")&&value!==undefined)) as Record<string,string>;
export async function mcp() {
  if (client) return client;
  const transport = new StdioClientTransport({ command: botConfig.mcpCommand, args: botConfig.mcpArgs, env:{...getDefaultEnvironment(),...rtsEnvironment()}, stderr: "inherit" });
  client = new Client({ name: "krd-market-telegram", version: "0.1.0" });
  await client.connect(transport); return client;
}
export async function call<T = unknown>(name: string, args: Record<string, unknown> = {}): Promise<T> {
  const result = await (await mcp()).callTool({ name, arguments: args });
  if (result.isError) throw new Error((result.content as Array<{ text?: string }>).map(x => x.text).filter(Boolean).join("\n"));
  const raw = (result.content as Array<{ type: string; text?: string }>).find(x => x.type === "text")?.text ?? "null";
  return JSON.parse(raw) as T;
}
export async function closeMcp() { await client?.close(); client = undefined; }

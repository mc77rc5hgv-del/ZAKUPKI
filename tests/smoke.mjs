import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const node = process.execPath;
const transport = new StdioClientTransport({ command: node, args: ["dist/entrypoints/mcp.js"] });
const client = new Client({ name: "smoke", version: "1.0.0" });
await client.connect(transport);
const { tools } = await client.listTools();
if (tools.length !== 23) throw new Error(`Expected 23 tools, received ${tools.length}`);
console.log(tools.map(tool => tool.name).join("\n"));
await client.close();

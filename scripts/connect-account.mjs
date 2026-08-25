import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const transport = new StdioClientTransport({ command: process.execPath, args: ["dist/entrypoints/mcp.js"], stderr: "inherit" });
const client = new Client({ name: "krd-market-account-setup", version: "1.0.0" });
await client.connect(transport);

const callJson = async (name, args = {}) => {
  const result = await client.callTool({ name, arguments: args });
  if (result.isError) throw new Error(result.content.map(x => x.text ?? "").join("\n"));
  return JSON.parse(result.content.find(x => x.type === "text")?.text ?? "null");
};

console.log("Открываю постоянный браузерный профиль РТС.");
console.log("В открывшемся Chromium вручную пройдите Anti-DDoS и войдите в аккаунт. Не вводите секреты в терминал.");

let last = "";
for (let attempt = 0; attempt < 360; attempt++) {
  const status = await callJson("rts_session_status");
  const rendered = JSON.stringify(status);
  if (rendered !== last) console.log(new Date().toISOString(), status);
  last = rendered;
  if (status.likelyLoggedIn && !status.antiDdos) {
    console.log("Авторизация распознана.");
    console.log(await callJson("rts_workspace"));
    await client.close();
    process.exit(0);
  }
  await new Promise(resolve => setTimeout(resolve, 10_000));
}

console.error("Вход не был распознан за один час. Профиль сохранён; запустите команду повторно.");
await client.close();
process.exit(1);

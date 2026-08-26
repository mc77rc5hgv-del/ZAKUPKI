import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

const profileDir = path.resolve(process.env.RTS_CDP_PROFILE_DIR ?? ".rts-chrome-profile");
const port = Number(process.env.RTS_CDP_PORT ?? 9222);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error("RTS_CDP_PORT должен быть целым числом от 1024 до 65535.");

const candidates = process.platform === "win32" ? [
  process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, "Google/Chrome/Application/chrome.exe"),
  process.env["PROGRAMFILES(X86)"] && path.join(process.env["PROGRAMFILES(X86)"], "Google/Chrome/Application/chrome.exe"),
  process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, "Google/Chrome/Application/chrome.exe"),
] : process.platform === "darwin" ? ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"] : ["/usr/bin/google-chrome", "/usr/bin/google-chrome-stable"];
const executable = candidates.filter(Boolean).find(candidate => fs.existsSync(candidate));
if (!executable) throw new Error("Google Chrome не найден. Установите Chrome или укажите поддерживаемый браузер вручную.");

fs.mkdirSync(profileDir, { recursive: true });
const child = spawn(executable, [
  `--remote-debugging-port=${port}`,
  "--remote-debugging-address=127.0.0.1",
  `--user-data-dir=${profileDir}`,
  "https://krd-market.rts-tender.ru/zapros/",
], { detached: true, stdio: "ignore" });
child.unref();
console.log(`Chrome запущен с отдельным профилем ${profileDir}`);
console.log(`После ручной проверки запустите агент с RTS_CDP_URL=http://127.0.0.1:${port}`);

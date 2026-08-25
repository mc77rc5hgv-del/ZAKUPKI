#!/usr/bin/env node
import { loadEnvFile } from "../config/load-env.js";

await loadEnvFile();
const { startWebServer } = await import("../interfaces/web/server.js");
await startWebServer();
await import("../interfaces/telegram/bot.js");

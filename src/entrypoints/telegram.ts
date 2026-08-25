#!/usr/bin/env node
import { loadEnvFile } from "../config/load-env.js";

await loadEnvFile();
await import("../interfaces/telegram/bot.js");

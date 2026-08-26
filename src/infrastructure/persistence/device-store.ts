import fs from "node:fs/promises";
import path from "node:path";
import { botConfig } from "../../config/bot.js";
import { generatePairingCode, hashSecret, normalizePairingCode, secretMatches } from "../security/pairing.js";
import { readStoreFile, writeStoreFile } from "../security/encrypted-store.js";

export type Device = {
  deviceId: string;
  ownerTelegramId: number;
  tokenHash: string;
  displayName: string;
  agentVersion?: string;
  createdAt: string;
  lastSeenAt?: string;
  revokedAt?: string;
};

export type PairingCode = {
  codeHash: string;
  ownerTelegramId: number;
  createdAt: string;
  expiresAt: string;
  usedAt?: string;
};

type Database = { devices: Device[]; pairingCodes: PairingCode[] };

const PAIRING_TTL_MS = 10 * 60_000;
const MAX_DISPLAY_NAME = 80;
const MAX_AGENT_VERSION = 40;

let db: Database = { devices: [], pairingCodes: [] };
let loaded = false;
const file = () => path.join(botConfig.dataDir, "devices.json");

export async function loadDeviceStore() {
  if (loaded) return;
  await fs.mkdir(botConfig.dataDir, { recursive: true });
  db = await readStoreFile<Database>(file(), { devices: [], pairingCodes: [] });
  db.devices ??= [];
  db.pairingCodes ??= [];
  loaded = true;
}

async function save() { await writeStoreFile(file(), db); }

function pruneExpiredCodes(now = Date.now()) {
  db.pairingCodes = db.pairingCodes.filter(c => !c.usedAt && new Date(c.expiresAt).getTime() > now - 60_000);
}

export async function createPairingCode(ownerTelegramId: number): Promise<{ code: string; expiresAt: string }> {
  const code = generatePairingCode();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + PAIRING_TTL_MS).toISOString();
  pruneExpiredCodes(now.getTime());
  db.pairingCodes.push({ codeHash: hashSecret(normalizePairingCode(code)), ownerTelegramId, createdAt: now.toISOString(), expiresAt });
  await save();
  return { code, expiresAt };
}

export async function redeemPairingCode(rawCode: string): Promise<{ ownerTelegramId: number } | undefined> {
  const candidate = normalizePairingCode(rawCode);
  if (!candidate) return undefined;
  const now = Date.now();
  pruneExpiredCodes(now);
  const record = db.pairingCodes.find(c => !c.usedAt && new Date(c.expiresAt).getTime() > now && secretMatches(candidate, c.codeHash));
  if (!record) return undefined;
  record.usedAt = new Date().toISOString();
  await save();
  return { ownerTelegramId: record.ownerTelegramId };
}

export async function registerDevice(input: { deviceId: string; ownerTelegramId: number; token: string; displayName?: string; agentVersion?: string }): Promise<Device> {
  if (!/^[A-Za-z0-9._:-]{8,128}$/.test(input.deviceId)) throw new Error("DEVICE_ID_INVALID");
  if (!Number.isSafeInteger(input.ownerTelegramId) || input.ownerTelegramId <= 0) throw new Error("OWNER_ID_INVALID");
  if (!/^[A-Za-z0-9_-]{40,128}$/.test(input.token)) throw new Error("DEVICE_TOKEN_INVALID");
  const now = new Date().toISOString();
  const existing = findDevice(input.deviceId);
  if (existing && existing.ownerTelegramId !== input.ownerTelegramId) {
    throw new Error("DEVICE_ID_ALREADY_OWNED");
  }
  const device: Device = {
    deviceId: input.deviceId,
    ownerTelegramId: input.ownerTelegramId,
    tokenHash: hashSecret(input.token),
    displayName: (input.displayName ?? "Компьютер").replace(/[\x00-\x1f\x7f]/g, " ").trim().slice(0, MAX_DISPLAY_NAME) || "Компьютер",
    agentVersion: input.agentVersion?.replace(/[\x00-\x1f\x7f]/g, "").trim().slice(0, MAX_AGENT_VERSION),
    createdAt: existing?.createdAt ?? now,
    revokedAt: undefined,
  };
  db.devices = db.devices.filter(d => d.deviceId !== input.deviceId);
  db.devices.push(device);
  await save();
  return device;
}

export function findDevice(deviceId: string): Device | undefined {
  return db.devices.find(d => d.deviceId === deviceId);
}

export function devicesForOwner(ownerTelegramId: number): Device[] {
  return db.devices.filter(d => d.ownerTelegramId === ownerTelegramId);
}

export async function touchDevice(deviceId: string) {
  const device = findDevice(deviceId);
  if (!device) return;
  device.lastSeenAt = new Date().toISOString();
  await save();
}

export async function revokeDevice(ownerTelegramId: number, deviceId: string): Promise<Device | undefined> {
  const device = findDevice(deviceId);
  if (!device || device.ownerTelegramId !== ownerTelegramId) return undefined;
  device.revokedAt = new Date().toISOString();
  await save();
  return device;
}

export function publicDevice(device: Device) {
  return { deviceId: device.deviceId, displayName: device.displayName, agentVersion: device.agentVersion, createdAt: device.createdAt, lastSeenAt: device.lastSeenAt, revokedAt: device.revokedAt };
}

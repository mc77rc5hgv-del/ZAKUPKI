import fs from "node:fs/promises";
import path from "node:path";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

// At-rest encryption for the small JSON stores under BOT_DATA_DIR (bot.json,
// devices.json). Encryption only activates when DATA_ENCRYPTION_KEY is set —
// deployments that don't set it keep today's plaintext behavior. Once a key is
// configured, the next write transparently migrates a plaintext file to the
// encrypted envelope. Migration backups use the same AES-GCM envelope and
// therefore never leave a second plaintext copy beside the active store.

const FORMAT_VERSION = 1;
const writeQueues = new Map<string, Promise<void>>();
type EncryptedEnvelope = { __encrypted: true; v: number; iv: string; tag: string; data: string };

function isEnvelope(value: unknown): value is EncryptedEnvelope {
  return Boolean(value) && typeof value === "object" && (value as Record<string, unknown>).__encrypted === true;
}

function loadKey(): Buffer | undefined {
  const raw = process.env.DATA_ENCRYPTION_KEY?.trim();
  if (!raw) return undefined;
  const key = /^[0-9a-f]{64}$/i.test(raw) ? Buffer.from(raw, "hex") : Buffer.from(raw, "base64");
  if (key.length !== 32) throw new Error("DATA_ENCRYPTION_KEY должен раскодироваться в 32 байта (AES-256): используйте 64 hex-символа или base64 32 байт.");
  return key;
}

function encrypt(plaintext: string, key: Buffer): EncryptedEnvelope {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const data = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return { __encrypted: true, v: FORMAT_VERSION, iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64"), data: data.toString("base64") };
}

function decrypt(envelope: EncryptedEnvelope, key: Buffer): string {
  if (envelope.v !== FORMAT_VERSION) throw new Error(`Неизвестная версия формата зашифрованного хранилища: ${envelope.v}`);
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(envelope.iv, "base64"));
    decipher.setAuthTag(Buffer.from(envelope.tag, "base64"));
    return Buffer.concat([decipher.update(Buffer.from(envelope.data, "base64")), decipher.final()]).toString("utf8");
  } catch {
    // Never include the key or ciphertext in the error — only a diagnosis.
    throw new Error("Не удалось расшифровать хранилище: неверный DATA_ENCRYPTION_KEY или повреждённые данные.");
  }
}

export async function readStoreFile<T>(file: string, fallback: T): Promise<T> {
  const raw = await fs.readFile(file, "utf8").catch(() => undefined);
  if (raw === undefined) return fallback;
  const parsed = JSON.parse(raw) as unknown;
  if (!isEnvelope(parsed)) return parsed as T; // legacy/plaintext — migrated on next write
  const key = loadKey();
  if (!key) throw new Error(`Хранилище ${file} зашифровано, но DATA_ENCRYPTION_KEY не задан в этом процессе.`);
  return JSON.parse(decrypt(parsed, key)) as T;
}

export async function writeStoreFile(file: string, value: unknown): Promise<void> {
  const previous = writeQueues.get(file) ?? Promise.resolve();
  const queued = previous.catch(() => undefined).then(() => writeStoreFileNow(file, value));
  writeQueues.set(file, queued);
  try { await queued; } finally { if (writeQueues.get(file) === queued) writeQueues.delete(file); }
}

async function writeStoreFileNow(file: string, value: unknown): Promise<void> {
  const key = loadKey();
  if (key) {
    await encryptLegacyBackups(file, key);
    await backupPlaintextOnFirstMigration(file, key);
  }
  const serialized = JSON.stringify(value, null, 2);
  const payload = key ? JSON.stringify(encrypt(serialized, key), null, 2) : serialized;
  const temp = `${file}.tmp`;
  await fs.writeFile(temp, payload, { encoding: "utf8", mode: 0o600 });
  await fs.rename(temp, file);
  await fs.chmod(file, 0o600).catch(() => {});
}

async function backupPlaintextOnFirstMigration(file: string, key: Buffer): Promise<void> {
  const previous = await fs.readFile(file, "utf8").catch(() => undefined);
  if (previous === undefined) return; // nothing to migrate yet
  let alreadyEncrypted = false;
  try { alreadyEncrypted = isEnvelope(JSON.parse(previous)); } catch { /* corrupt/plaintext — back it up as-is */ }
  if (!alreadyEncrypted) {
    const backup = JSON.stringify(encrypt(previous, key), null, 2);
    await fs.writeFile(`${file}.bak-${Date.now()}.enc`, backup, { encoding: "utf8", mode: 0o600 });
  }
}

async function encryptLegacyBackups(file: string, key: Buffer): Promise<void> {
  const directory = path.dirname(file);
  const prefix = `${path.basename(file)}.bak-`;
  const names = await fs.readdir(directory).catch(() => []);
  for (const name of names) {
    if (!name.startsWith(prefix)) continue;
    const backupPath = path.join(directory, name);
    const raw = await fs.readFile(backupPath, "utf8").catch(() => undefined);
    if (raw === undefined) continue;
    try { if (isEnvelope(JSON.parse(raw))) continue; } catch { /* legacy plaintext or malformed JSON */ }
    const temp = `${backupPath}.tmp`;
    await fs.writeFile(temp, JSON.stringify(encrypt(raw, key), null, 2), { encoding: "utf8", mode: 0o600 });
    await fs.rename(temp, backupPath);
  }
}

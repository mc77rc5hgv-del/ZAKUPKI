import { randomBytes, createHash, timingSafeEqual } from "node:crypto";

const CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTVWXYZ"; // no 0/O/1/I/L — unambiguous when read aloud or typed
const CODE_LENGTH = 10;

export function generatePairingCode(): string {
  const bytes = randomBytes(CODE_LENGTH);
  let raw = "";
  for (let i = 0; i < CODE_LENGTH; i++) raw += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  return `${raw.slice(0, 5)}-${raw.slice(5)}`;
}

export function normalizePairingCode(input: string): string {
  return input.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export function hashSecret(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function secretMatches(candidate: string, expectedHash: string): boolean {
  const a = Buffer.from(hashSecret(candidate), "hex");
  const b = Buffer.from(expectedHash, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

export function generateDeviceToken(): string {
  return randomBytes(32).toString("base64url");
}

export function generateDeviceId(): string {
  return randomBytes(16).toString("hex");
}

import assert from "node:assert/strict";

process.env.TELEGRAM_ALLOWED_USERS = "42,7,99";
process.env.RTS_HEADLESS = "true";
delete process.env.RTS_ACCOUNT_OWNER_ID;
process.env.RTS_ACCOUNT_OWNER_IDS = "42,7";
delete process.env.RTS_ALLOW_CLOUD_ACCOUNT_SESSION;

const { assertRtsAccess, botConfig, rtsAccess } = await import(
  "../dist/config/bot.js"
);

assert.deepEqual([...botConfig.rtsAccountOwnerIds], [42, 7]);
assert.deepEqual(rtsAccess(42), {
  isOwner: true,
  ownerConfigured: true,
  cloudBlocked: true,
});
assert.throws(() => assertRtsAccess(42), /облачная авторизация/i);
assert.throws(() => assertRtsAccess(7), /облачная авторизация/i);
assert.throws(() => assertRtsAccess(99), /другому пользователю|не настроена/i);

console.log("RTS account isolation: OK");

import assert from "node:assert/strict";

process.env.TELEGRAM_ALLOWED_USERS = "42";
process.env.RTS_HEADLESS = "true";
delete process.env.RTS_ACCOUNT_OWNER_ID;
delete process.env.RTS_ALLOW_CLOUD_ACCOUNT_SESSION;

const { assertRtsAccess, botConfig, rtsAccess } = await import(
  "../dist/config/bot.js"
);

assert.equal(botConfig.rtsAccountOwnerId, 42);
assert.deepEqual(rtsAccess(42), {
  isOwner: true,
  ownerConfigured: true,
  cloudBlocked: true,
});
assert.throws(() => assertRtsAccess(42), /облачная авторизация/i);
assert.throws(() => assertRtsAccess(7), /другому пользователю/i);

console.log("RTS account isolation: OK");

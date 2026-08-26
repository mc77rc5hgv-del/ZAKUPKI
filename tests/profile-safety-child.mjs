import { forgetProfile } from "../dist/infrastructure/rts/browser.js";

try {
  await forgetProfile(process.env.TEST_CONFIRM ?? "");
  process.stdout.write("deleted");
} catch (error) {
  process.stderr.write(error instanceof Error ? error.message : String(error));
  process.exitCode = 2;
}

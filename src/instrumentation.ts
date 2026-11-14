/**
 * Next runs register() once at start, before any request. In the Node runtime it reads AUTH_ENABLED and
 * LEDGER_MODE strictly (src/vendor/aisc-ledger/switches.ts) and stops the app on a value that is not a switch
 * word, instead of quietly turning sign-in checks or the ledger off.
 */
import { checkSwitches, SwitchInvalid } from "@/vendor/aisc-ledger/switches";

export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  try {
    checkSwitches();
  } catch (e) {
    if (!(e instanceof SwitchInvalid)) throw e;
    console.error(`refusing to start: ${e.message}`);
    process.exit(1);
  }
}

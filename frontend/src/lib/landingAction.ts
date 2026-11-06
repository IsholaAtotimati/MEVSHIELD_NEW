import { LOCAL_CHAIN_ID } from "../config/chainEnv.ts";
import { WALLET_STATUS } from "./walletConnect.ts";

/** Console route the landing page opens after a wallet is connected. */
export const TRADE_PATH = "/trade" as const;

export type LandingAction =
  | { kind: "connect"; label: "Connect wallet" }
  | { kind: "enter"; label: "Enter app"; to: typeof TRADE_PATH };

const HIDDEN_LANDING_STATUS = new Set<string>([
  WALLET_STATUS.disconnected,
  WALLET_STATUS.connecting,
  WALLET_STATUS.connected,
  WALLET_STATUS.anvil,
]);

/** Header action. An account enters the console. Otherwise the visitor connects. */
export function landingAction(account: string | null): LandingAction {
  if (account) {
    return { kind: "enter", label: "Enter app", to: TRADE_PATH };
  }
  return { kind: "connect", label: "Connect wallet" };
}

const SEPOLIA_LIMIT =
  "Experimental. Sepolia testnet. The execute path stays closed until the live deployment is verified.";
const LOCAL_LIMIT =
  "Experimental. Local anvil. Test tokens have no real-world value.";

/** Public copy names Sepolia. The local retest build names anvil instead. */
export function landingLimit(chainId: number): string {
  return chainId === LOCAL_CHAIN_ID ? LOCAL_LIMIT : SEPOLIA_LIMIT;
}

/** Short lifetime label. The number comes from `POLICY_TTL_SECONDS`, not from this function. */
export function policyLifetimeLabel(ttlSeconds: number): string {
  const minutes = Math.round(ttlSeconds / 60);
  return `${minutes} min`;
}

/** Where a successful connect goes. A refusal stays on the landing page. */
export function pathAfterConnect(account: string | null): typeof TRADE_PATH | null {
  return account ? TRADE_PATH : null;
}

/**
 * Idle, in-progress, and success strings stay off the landing page.
 * A refusal, a failure, and any other notice (such as the local mint prompt) show.
 */
export function showsLandingWalletStatus(status: string): boolean {
  return !HIDDEN_LANDING_STATUS.has(status);
}

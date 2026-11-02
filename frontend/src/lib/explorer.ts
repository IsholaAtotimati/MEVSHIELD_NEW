/**
 * Block explorer links for the active chain.
 *
 * Split out of `format.ts` on purpose: `format.ts` is pure formatting and is
 * loaded by the Node test runner, which cannot resolve `import.meta.env`. This
 * module reads the build-time explorer setting, so only UI components import it.
 */
import { EXPLORER_BASE_URL, IS_LOCAL_CHAIN } from "../config/chain";

/** Whether this build has an explorer to link to. */
export const HAS_EXPLORER = EXPLORER_BASE_URL !== null;

/** Label for the explorer. A local chain has none, so the text is generic. */
export const EXPLORER_NAME = IS_LOCAL_CHAIN ? "explorer" : "Sepolia Etherscan";

/** Explorer transaction URL, or null when the chain has no explorer. */
export function explorerTxUrl(txHash: string): string | null {
  if (!EXPLORER_BASE_URL) return null;
  return `${EXPLORER_BASE_URL}/tx/${txHash}`;
}

/** Explorer address URL, or null when the chain has no explorer. */
export function explorerAddressUrl(address: string): string | null {
  if (!EXPLORER_BASE_URL) return null;
  return `${EXPLORER_BASE_URL}/address/${address}`;
}

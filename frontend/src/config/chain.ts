/**
 * Chain and RPC selection for the browser client.
 *
 * Sepolia is the default and remains the only chain any deployed build points
 * at. Every value here can be overridden with a `VITE_*` variable so the local
 * Docker stack can target anvil instead, but the fallbacks are the published
 * Sepolia values. `VITE_*` values are inlined into the public bundle, so
 * nothing secret may live here.
 *
 * This module decides *where to read from*. It never decides whether an action
 * is allowed; the execute gate lives in `config/env.ts` and
 * `lib/protectedQuote.ts`. The pure resolution rules are in `chainEnv.ts`.
 */
import {
  LOCAL_CHAIN_ID,
  resolveChainId,
  resolveChainLabel,
  resolveChainName,
  resolveExplorerUrl,
  resolveRpcUrl,
  SEPOLIA_CHAIN_ID,
} from "./chainEnv";

export { LOCAL_CHAIN_ID, SEPOLIA_CHAIN_ID };

/**
 * Chain the client reads and asks the wallet to switch to.
 *
 * `VITE_CHAIN_ID` wins when it parses as a positive integer; otherwise the
 * build stays on Sepolia. A malformed value does not silently become anvil.
 */
export const CHAIN_ID: number = resolveChainId(import.meta.env.VITE_CHAIN_ID);

export const IS_LOCAL_CHAIN = CHAIN_ID === LOCAL_CHAIN_ID;

export const RPC_URL: string = resolveRpcUrl(
  import.meta.env.VITE_RPC_URL,
  CHAIN_ID,
);

export const CHAIN_NAME = resolveChainName(CHAIN_ID);

export const CHAIN_LABEL = resolveChainLabel(CHAIN_ID);

/** Block explorer base for address and transaction links, when one exists. */
export const EXPLORER_BASE_URL = resolveExplorerUrl(
  import.meta.env.VITE_EXPLORER_URL,
  CHAIN_ID,
);

export const NATIVE_CURRENCY = IS_LOCAL_CHAIN
  ? { name: "Ether", symbol: "ETH", decimals: 18 }
  : { name: "Sepolia Ether", symbol: "ETH", decimals: 18 };

export const CHAIN = {
  id: CHAIN_ID,
  name: CHAIN_NAME,
  nativeCurrency: NATIVE_CURRENCY,
  rpcUrls: {
    default: {
      http: [RPC_URL],
    },
  },
} as const;

/**
 * Name of the test-token suffix shown next to the pair. Local mock tokens are
 * not Sepolia tokens, so the label has to follow the chain.
 */
export const TOKEN_NETWORK_LABEL = IS_LOCAL_CHAIN ? "Local" : "Sepolia";

/// <reference types="vite/client" />

interface Window {
  ethereum?: {
    request: (args: {
      method: string;
      params?: unknown[];
    }) => Promise<unknown>;
  };
}

/**
 * Build-time variables read by this app. Vite inlines these into the public
 * bundle, so none of them may hold a secret. Every one is optional; the
 * defaults in `config/chain.ts` and `lib/contracts.ts` are the Sepolia
 * deployment.
 */
interface ImportMetaEnv {
  /** Base URL for backend calls. Default `http://localhost:4000`. */
  readonly VITE_API_URL?: string;
  /**
   * Opt-in flag for the deterministic demo estimate path. Requires the Vite dev
   * server on Sepolia; also allowed from a built bundle on the local chain.
   */
  readonly VITE_SEPOLIA_DEMO_MODE?: string;
  /** The explicit deployment-verification assertion. Leave unset. */
  readonly VITE_MINIMUM_OUTPUT_V2_DEPLOYMENT_VERIFIED?: string;
  /**
   * Contents of the running local stack's `/deployments/local.json`, as a JSON
   * string. Only consulted on chain 31337, and only when the flag above is not
   * set. See `lib/minimumOutputVerification.ts`.
   */
  readonly VITE_LOCAL_DEPLOYMENT_RECORD?: string;

  /** Chain to read. Default `11155111`. Set to `31337` for the local stack. */
  readonly VITE_CHAIN_ID?: string;
  /** Read RPC endpoint. Defaults to the public Sepolia RPC. */
  readonly VITE_RPC_URL?: string;
  /** Optional block explorer base URL. Local builds have none by default. */
  readonly VITE_EXPLORER_URL?: string;

  /** Overrides for the addresses in `lib/contracts.ts`. */
  readonly VITE_POOL_MANAGER_ADDRESS?: string;
  readonly VITE_POLICY_REGISTRY_ADDRESS?: string;
  readonly VITE_POLICY_VERIFIER_ADDRESS?: string;
  readonly VITE_POLICY_AUTHORIZATION_ADDRESS?: string;
  readonly VITE_MEVSHIELD_HOOK_ADDRESS?: string;
  readonly VITE_MEVSHIELD_ROUTER_ADDRESS?: string;
  readonly VITE_AUTHORIZED_SIGNER_ADDRESS?: string;

  /** Base token addresses for the local mock pair. */
  readonly VITE_TOKEN0_ADDRESS?: string;
  readonly VITE_TOKEN1_ADDRESS?: string;
  readonly VITE_TOKEN0_SYMBOL?: string;
  readonly VITE_TOKEN1_SYMBOL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

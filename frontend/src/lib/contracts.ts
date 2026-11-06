/**
 * Contract addresses the client reads.
 *
 * The Sepolia addresses below are the published deployment and remain the
 * defaults. Each can be overridden with a `VITE_*` variable so the local Docker
 * stack can point at the contracts `script/DeployLocal.s.sol` deployed to anvil.
 *
 * Fail-closed note: these addresses are display and read targets only. Changing
 * them does not open the execute gate. The gate is
 * `VITE_MINIMUM_OUTPUT_V2_DEPLOYMENT_VERIFIED` in `config/env.ts`, and the
 * readiness checks in `lib/protectedQuote.ts` still refuse to execute unless
 * every on-chain check passes.
 */
import type { Address } from "viem";

import { CHAIN, CHAIN_ID } from "../config/chain";

export { CHAIN_ID };

/** Chain definition used by every viem client. */
export const SEPOLIA_CHAIN = CHAIN;

type ContractAddresses = {
  poolManager: Address;
  policyRegistry: Address;
  policyVerifier: Address;
  policyAuthorization: Address;
  mevShieldHook: Address;
  mevShieldRouter: Address;
  authorizedSigner: Address;
};

function readAddress(value: string | undefined): Address | undefined {
  const trimmed = value?.trim();
  return trimmed ? (trimmed as Address) : undefined;
}

const SEPOLIA_CONTRACTS: ContractAddresses = {
  poolManager: "0xE03A1074c86CFeDd5C142C4F04F1a1536e203543",
  policyRegistry: "0xB2897da1CfC0c73C3983221a87C27586D1cE1c9E",
  policyVerifier: "0x716f9315BC9c2AB98a82DDE78ca86887Ab61b79f",
  policyAuthorization: "0xefC9bc21f1ab3564232a3216f0e45d5caE3Bd7c5",
  mevShieldHook: "0xd15e4fdd391a68c2f1c385d1a819117a3ad40080",
  mevShieldRouter: "0x633282608B2fc66cD7572f5eF58e804063aa150D",
  authorizedSigner: "0x016B78a30CE176EF0B90c122e8677e13aAB2A815",
};

/**
 * Deterministic addresses that `script/DeployLocal.s.sol` produces from a fresh
 * anvil. Used as the local defaults so `docker compose up` needs no address
 * wiring, and overridable for a redeployed stack.
 */
const LOCAL_CONTRACTS: ContractAddresses = {
  poolManager: "0x5FbDB2315678afecb367f032d93F642f64180aa3",
  policyRegistry: "0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512",
  policyVerifier: "0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0",
  policyAuthorization: "0xCf7Ed3AccA5a467e9e704C703E8D87F634fB0Fc9",
  mevShieldHook: "0x1e2F391574556815aE705895F2728543A7AD4080",
  mevShieldRouter: "0x8A791620dd6260079BF849Dc5567aDC3F2FdC318",
  authorizedSigner: "0xe05fcC23807536bEe418f142D19fa0d21BB0cfF7",
};

/**
 * Only a local build may fall back to the anvil addresses. A Sepolia build with
 * no overrides always gets the Sepolia deployment, never the local one.
 */
const DEFAULT_CONTRACTS: ContractAddresses =
  CHAIN_ID === 31337 ? LOCAL_CONTRACTS : SEPOLIA_CONTRACTS;

const policyAuthorization =
  readAddress(import.meta.env.VITE_POLICY_AUTHORIZATION_ADDRESS) ??
  DEFAULT_CONTRACTS.policyAuthorization;

export const CONTRACTS = {
  poolManager:
    readAddress(import.meta.env.VITE_POOL_MANAGER_ADDRESS) ??
    DEFAULT_CONTRACTS.poolManager,

  policyRegistry:
    readAddress(import.meta.env.VITE_POLICY_REGISTRY_ADDRESS) ??
    DEFAULT_CONTRACTS.policyRegistry,

  policyVerifier:
    readAddress(import.meta.env.VITE_POLICY_VERIFIER_ADDRESS) ??
    DEFAULT_CONTRACTS.policyVerifier,

  policyAuthorization,

  /** Legacy alias. Always the same contract as `policyAuthorization`. */
  poolAuthorization: policyAuthorization,

  mevShieldHook:
    readAddress(import.meta.env.VITE_MEVSHIELD_HOOK_ADDRESS) ??
    DEFAULT_CONTRACTS.mevShieldHook,

  mevShieldRouter:
    readAddress(import.meta.env.VITE_MEVSHIELD_ROUTER_ADDRESS) ??
    DEFAULT_CONTRACTS.mevShieldRouter,

  authorizedSigner:
    readAddress(import.meta.env.VITE_AUTHORIZED_SIGNER_ADDRESS) ??
    DEFAULT_CONTRACTS.authorizedSigner,
} as const;

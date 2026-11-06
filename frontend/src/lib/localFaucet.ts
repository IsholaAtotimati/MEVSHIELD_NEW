import { parseEther, type Address } from "viem";

import { CHAIN, IS_LOCAL_CHAIN } from "../config/chain";
import { SWAP_TOKENS, type TokenSymbol } from "../config/swapPool";
import { LOCAL_CHAIN_ID } from "../config/chainEnv";
import { publicClient } from "./viem";

const mockMintAbi = [
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "owner", type: "address" }],
    outputs: [{ name: "balance", type: "uint256" }],
  },
  {
    type: "function",
    name: "mint",
    stateMutability: "nonpayable",
    inputs: [
      { name: "to", type: "address" },
      { name: "value", type: "uint256" },
    ],
    outputs: [],
  },
] as const;

/** 1,000 tokens. Both local mock tokens use 18 decimals. */
export const LOCAL_TEST_TOKEN_AMOUNT = 1_000n * 10n ** 18n;

/** 100 ETH, enough for gas on the local chain. */
export const LOCAL_TEST_ETH = parseEther("100");

type MintingWallet = {
  writeContract: (args: {
    account: Address;
    chain: typeof CHAIN;
    address: Address;
    abi: typeof mockMintAbi;
    functionName: "mint";
    args: readonly [Address, bigint];
  }) => Promise<unknown>;
};

/** Only the local anvil chain may receive a balance or a mock mint. */
export function shouldFundInjectedAccount(chainId: number): boolean {
  return chainId === LOCAL_CHAIN_ID;
}

async function tokenBalance(token: Address, owner: Address): Promise<bigint> {
  return publicClient.readContract({
    address: token,
    abi: mockMintAbi,
    functionName: "balanceOf",
    args: [owner],
  });
}

/**
 * Give the connected browser wallet local ETH and mock tokens.
 *
 * ETH comes from anvil's node method, which exists only on this chain. The
 * mint is sent by the connected wallet, so MetaMask has to approve it. No
 * private key is used.
 */
export async function fundInjectedLocalAccount(
  wallet: MintingWallet,
  account: Address,
): Promise<void> {
  if (!IS_LOCAL_CHAIN || !shouldFundInjectedAccount(CHAIN.id)) return;

  await publicClient.transport.request({
    method: "anvil_setBalance",
    params: [account, `0x${LOCAL_TEST_ETH.toString(16)}`],
  });

  const symbols: TokenSymbol[] = ["ETH", "USDC"];
  for (const symbol of symbols) {
    const token = SWAP_TOKENS[symbol].address;
    if (token === null) continue;
    if ((await tokenBalance(token, account)) > 0n) continue;
    await wallet.writeContract({
      account,
      chain: CHAIN,
      address: token,
      abi: mockMintAbi,
      functionName: "mint",
      args: [account, LOCAL_TEST_TOKEN_AMOUNT],
    });
  }
}

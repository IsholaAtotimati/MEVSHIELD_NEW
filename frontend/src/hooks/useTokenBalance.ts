import { useCallback, useEffect, useState } from "react";
import type { Address } from "viem";

import { erc20Abi } from "../lib/abis";
import { publicClient } from "../lib/viem";

type TokenBalanceState = {
  owner: Address;
  token: Address;
  balance: bigint | null;
};

/**
 * ERC-20 balance for the connected account. Trade uses this on the pool's
 * WETH address so the pay field reflects what execution actually spends.
 *
 * A cached read is only returned while it still belongs to the current account
 * and token, so switching either one never shows a stale amount.
 */
export function useTokenBalance(account: Address | null, token: Address) {
  const [state, setState] = useState<TokenBalanceState | null>(null);

  const refresh = useCallback(
    async (holder?: Address | null) => {
      const owner = holder ?? account;
      if (!owner) {
        setState(null);
        return;
      }
      try {
        const balance = await publicClient.readContract({
          address: token,
          abi: erc20Abi,
          functionName: "balanceOf",
          args: [owner],
        });
        setState({ owner, token, balance });
      } catch (error) {
        console.error(error);
        setState({ owner, token, balance: null });
      }
    },
    [account, token],
  );

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const isCurrent =
    state !== null &&
    account !== null &&
    state.token === token &&
    state.owner.toLowerCase() === account.toLowerCase();

  return {
    balance: isCurrent ? state.balance : null,
    refresh,
  };
}

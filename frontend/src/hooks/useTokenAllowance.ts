import { useCallback, useEffect, useState } from "react";
import type { Address } from "viem";

import { erc20Abi } from "../lib/abis";
import { publicClient } from "../lib/viem";

type AllowanceState = {
  key: string;
  allowance: bigint | null;
  error: string | null;
};

export function useTokenAllowance(
  account: Address | null,
  token: Address | null,
  spender: Address,
  enabled: boolean,
) {
  const [state, setState] = useState<AllowanceState | null>(null);
  const key =
    account && token
      ? `${account.toLowerCase()}:${token.toLowerCase()}:${spender.toLowerCase()}`
      : "";

  const refresh = useCallback(async () => {
    if (!enabled || !account || !token) {
      setState(null);
      return;
    }
    const requestKey =
      `${account.toLowerCase()}:${token.toLowerCase()}:${spender.toLowerCase()}`;
    try {
      const allowance = await publicClient.readContract({
        address: token,
        abi: erc20Abi,
        functionName: "allowance",
        args: [account, spender],
      });
      setState({ key: requestKey, allowance, error: null });
    } catch {
      setState({
        key: requestKey,
        allowance: null,
        error: "Could not verify the input-token allowance on Sepolia.",
      });
    }
  }, [account, enabled, spender, token]);

  useEffect(() => {
    if (!enabled || !account || !token) {
      setState(null);
      return;
    }
    void refresh();
    const interval = window.setInterval(() => void refresh(), 5_000);
    return () => window.clearInterval(interval);
  }, [account, enabled, refresh, token]);

  return {
    allowance: state?.key === key ? state.allowance : null,
    error: state?.key === key ? state.error : null,
    isChecking: enabled && Boolean(account && token) && state?.key !== key,
    refresh,
  };
}

import { useCallback, useEffect, useState } from "react";
import type { Address, Hex } from "viem";

import { CONTRACTS } from "../lib/contracts";
import {
  mevShieldHookAbi,
  policyRegistryEventsAbi,
} from "../lib/abis";
import {
  activityToCsv,
  appendActivity,
  loadStoredActivity,
} from "../lib/activityStorage";
import type { ActivityRow } from "../lib/types";
import { publicClient } from "../lib/viem";

const LOOKBACK_BLOCKS = 50_000n;

export function useActivityFeed(account: Address | null) {
  const [rows, setRows] = useState<ActivityRow[]>([]);
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const stored = loadStoredActivity();
      const latest = await publicClient.getBlockNumber();
      const fromBlock = latest > LOOKBACK_BLOCKS ? latest - LOOKBACK_BLOCKS : 0n;

      const [registeredLogs, enforcedLogs] = await Promise.all([
        publicClient.getLogs({
          address: CONTRACTS.policyRegistry,
          event: policyRegistryEventsAbi[0],
          fromBlock,
          toBlock: latest,
        }),
        publicClient.getLogs({
          address: CONTRACTS.mevShieldHook,
          event: mevShieldHookAbi[2],
          fromBlock,
          toBlock: latest,
        }),
      ]);

      const chainRows: ActivityRow[] = [];

      for (const log of registeredLogs) {
        const args = log.args as {
          policyId?: Hex;
          minAmountOut?: bigint;
          nonce?: bigint;
        };
        if (!log.transactionHash) continue;
        const tx = await publicClient.getTransaction({ hash: log.transactionHash });
        if (account && tx.from.toLowerCase() !== account.toLowerCase()) {
          continue;
        }
        chainRows.push({
          id: `${log.transactionHash}-reg`,
          time: Date.now(),
          pair: "WETH / USDC",
          amountIn: "—",
          amountOut: "—",
          minAmountOut: args.minAmountOut?.toString() ?? "—",
          status: "registered",
          txHash: log.transactionHash,
          policyId: args.policyId,
        });
      }

      for (const log of enforcedLogs) {
        if (!log.transactionHash) continue;
        const tx = await publicClient.getTransaction({ hash: log.transactionHash });
        if (account && tx.from.toLowerCase() !== account.toLowerCase()) {
          continue;
        }
        chainRows.push({
          id: `${log.transactionHash}-enf`,
          time: Date.now(),
          pair: "WETH / USDC",
          amountIn: "—",
          amountOut: "—",
          minAmountOut: "—",
          status: "enforced",
          txHash: log.transactionHash,
        });
      }

      const merged = [...stored, ...chainRows].reduce<ActivityRow[]>((acc, row) => {
        if (!acc.some((item) => item.id === row.id)) acc.push(row);
        return acc;
      }, []);
      merged.sort((a, b) => b.time - a.time);
      setRows(merged);
    } catch (error) {
      console.error(error);
      setRows(loadStoredActivity());
    } finally {
      setLoading(false);
    }
  }, [account]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const filtered =
    statusFilter === "all"
      ? rows
      : rows.filter((row) => row.status === statusFilter);

  function exportCsv() {
    const blob = new Blob([activityToCsv(filtered)], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "mevshield-activity.csv";
    anchor.click();
    URL.revokeObjectURL(url);
  }

  return {
    rows: filtered,
    loading,
    statusFilter,
    setStatusFilter,
    refresh,
    exportCsv,
    recordLocal: appendActivity,
  };
}

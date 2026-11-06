/**
 * A block explorer link that renders a dash when the current chain has none.
 *
 * The local Docker stack runs anvil, which has no explorer. Rather than
 * pointing users at a dead Sepolia URL for a local transaction, this renders
 * "—". On Sepolia it renders the usual Etherscan link.
 */
import type { ReactNode } from "react";

import {
  EXPLORER_NAME,
  explorerAddressUrl,
  explorerTxUrl,
} from "../lib/explorer";

type ExplorerLinkProps = {
  /** Transaction hash. Mutually exclusive with `address`. */
  txHash?: string;
  /** Address to link to. */
  address?: string;
  /** Visible text. Defaults to the explorer name. */
  children?: ReactNode;
};

export default function ExplorerLink({
  txHash,
  address,
  children,
}: ExplorerLinkProps) {
  const url = txHash
    ? explorerTxUrl(txHash)
    : address
      ? explorerAddressUrl(address)
      : null;

  if (!url) {
    return <span className="muted">—</span>;
  }

  return (
    <a href={url} target="_blank" rel="noreferrer">
      {children ?? EXPLORER_NAME}
    </a>
  );
}

import { CHAIN_NAME } from "../config/chain";
import { DEMO_ESTIMATE_MODE, READ_ONLY_DEMO_MODE } from "../config/env";
import { DEMO_USDC_PER_WETH } from "../lib/protectedQuote";

/** Amber strip, the same treatment the mockups use for an advisory. */
export default function DemoBanner() {
  if (!DEMO_ESTIMATE_MODE) return null;

  return (
    <div className="demo-banner" role="status">
      Demo mode is on. Estimates use a fixed {DEMO_USDC_PER_WETH.toString()} USDC
      per WETH rate, not a live pool quote. {READ_ONLY_DEMO_MODE
        ? "Policy signing and swap execution are disabled."
        : "Signing and execution use a 1-base-unit minimum output and do not verify the v2 deployment."}{" "}
      Use only with test tokens on {CHAIN_NAME}; this is not a protected trade.
    </div>
  );
}

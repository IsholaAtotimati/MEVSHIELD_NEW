import { CHAIN_NAME } from "../config/chain";
import { SEPOLIA_DEMO_MODE } from "../config/env";
import { DEMO_USDC_PER_WETH } from "../lib/protectedQuote";

/** Amber strip, the same treatment the mockups use for an advisory. */
export default function DemoBanner() {
  if (!SEPOLIA_DEMO_MODE) return null;

  return (
    <div className="demo-banner" role="status">
      Demo mode is on. Estimates use a fixed {DEMO_USDC_PER_WETH.toString()} USDC
      per WETH rate, not a live pool quote. {CHAIN_NAME} test tokens have no
      real-world value.
    </div>
  );
}

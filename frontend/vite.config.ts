import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv, type Plugin } from "vite";

import { builtChainMarker } from "./scripts/assertBuiltChain.mjs";
import { assertLocalBundleBuildAllowed } from "./scripts/localBundleGuard.mjs";

function refuseSepoliaOverwrite(viteChainId: string | undefined): Plugin {
  return {
    name: "refuse-sepolia-overwrite",
    apply: "build",
    buildStart() {
      assertLocalBundleBuildAllowed({
        ...process.env,
        VITE_CHAIN_ID: viteChainId,
      });
    },
  };
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  // A shell export wins over a .env file, matching the local-test script.
  const fromFile = loadEnv(mode, process.cwd(), "VITE_");
  const viteChainId = process.env.VITE_CHAIN_ID ?? fromFile.VITE_CHAIN_ID;

  return {
    define: {
      __MEVSHIELD_BUILT_CHAIN_MARKER__: JSON.stringify(
        builtChainMarker(viteChainId),
      ),
    },
    plugins: [react(), refuseSepoliaOverwrite(viteChainId)],
  };
});

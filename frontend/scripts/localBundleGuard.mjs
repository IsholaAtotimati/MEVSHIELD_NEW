/**
 * Stop a Sepolia build from replacing the Anvil bundle the local test
 * frontend is already serving.
 *
 * `mevshield-local-test-frontend` bind-mounts `frontend/dist`. `npm run build`
 * with no `VITE_CHAIN_ID` compiles the Sepolia default (11155111) into that
 * directory, and the open page changes under you: the top bar says
 * "Sepolia · 11155111" and Connect wallet asks for a browser extension.
 *
 * The container not running is the normal Sepolia and CI build. Chain id 1
 * is not anvil.
 */
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

export const LOCAL_TEST_FRONTEND_CONTAINER = "mevshield-local-test-frontend";
export const LOCAL_TEST_CHAIN_ID = "31337";

export function decideBundleBuild(input) {
  const chain =
    typeof input.viteChainId === "string" ? input.viteChainId.trim() : "";
  if (!input.localTestFrontendRunning) {
    return { allow: true };
  }
  if (chain === LOCAL_TEST_CHAIN_ID) {
    return { allow: true };
  }
  const shown = chain === "" ? "unset" : JSON.stringify(chain);
  return {
    allow: false,
    message:
      `Refusing to build frontend/dist while ${LOCAL_TEST_FRONTEND_CONTAINER} is serving it. ` +
      `VITE_CHAIN_ID is ${shown}. An unset value compiles Sepolia (11155111), ` +
      `and chain id 1 is not anvil, so Connect wallet would ask for a browser extension ` +
      `instead of the anvil account. ` +
      `Run ./script/local-test-flow.sh, which exports VITE_CHAIN_ID=31337 before it builds. ` +
      `Stop the container with ./script/local-test-flow.sh --stop before a Sepolia build.`,
  };
}

export function localTestFrontendIsRunning() {
  try {
    const out = execFileSync(
      "docker",
      [
        "inspect",
        "-f",
        "{{.State.Running}}",
        LOCAL_TEST_FRONTEND_CONTAINER,
      ],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
    );
    return out.trim() === "true";
  } catch {
    return false;
  }
}

export function assertLocalBundleBuildAllowed(
  env = process.env,
  running = localTestFrontendIsRunning(),
) {
  const decision = decideBundleBuild({
    viteChainId: env.VITE_CHAIN_ID,
    localTestFrontendRunning: running,
  });
  if (!decision.allow) {
    throw new Error(decision.message);
  }
}

function isDirectRun() {
  const entry = process.argv[1];
  if (!entry) return false;
  return fileURLToPath(import.meta.url) === entry;
}

if (isDirectRun()) {
  try {
    assertLocalBundleBuildAllowed();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

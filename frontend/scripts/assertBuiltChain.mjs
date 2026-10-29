/**
 * Read the chain id Vite baked into a frontend bundle.
 *
 * `import.meta.env.VITE_CHAIN_ID` is replaced at build time. The define in
 * `vite.config.ts` emits one literal, `mevshield-built-chain:<id>`, from that
 * raw value. An unset variable is `unset`, which the app then treats as
 * Sepolia. This script fails closed unless the literal is exactly the chain
 * the caller asked for, so a Sepolia bundle cannot be published as the local
 * anvil page.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export const BUILT_CHAIN_MARKER_PREFIX = "mevshield-built-chain:";

export function builtChainMarker(rawChainId) {
  const trimmed = typeof rawChainId === "string" ? rawChainId.trim() : "";
  if (trimmed === "") return `${BUILT_CHAIN_MARKER_PREFIX}unset`;
  if (!/^\d+$/.test(trimmed)) return `${BUILT_CHAIN_MARKER_PREFIX}invalid`;
  return `${BUILT_CHAIN_MARKER_PREFIX}${trimmed}`;
}

/** Every marker literal in a bundle. More than one means the build did not fold to a single chain. */
export function findBuiltChainMarkers(source) {
  return [
    ...source.matchAll(/mevshield-built-chain:(?:unset|invalid|\d+)/g),
  ].map((match) => match[0]);
}

export function assertBundleChain(source, expectedChainId) {
  const expected = builtChainMarker(String(expectedChainId));
  const found = findBuiltChainMarkers(source);
  if (found.length === 1 && found[0] === expected) {
    return { ok: true, marker: found[0] };
  }
  const shown = found.length === 0 ? "missing" : found.join(", ");
  return {
    ok: false,
    message:
      `Bundle chain marker is ${shown}; expected exactly ${expected}. ` +
      `A build without VITE_CHAIN_ID bakes mevshield-built-chain:unset and the app runs as Sepolia. ` +
      `Rebuild with ./script/local-test-flow.sh.`,
  };
}

export function readDistSource(distDir) {
  const assetsDir = join(distDir, "assets");
  let files;
  try {
    files = readdirSync(assetsDir).filter((name) => name.endsWith(".js"));
  } catch {
    throw new Error(`No JS assets in ${assetsDir}. The frontend build did not emit a bundle.`);
  }
  if (files.length === 0) {
    throw new Error(`No JS assets in ${assetsDir}.`);
  }
  return files.map((name) => readFileSync(join(assetsDir, name), "utf8")).join("\n");
}

function isDirectRun() {
  const entry = process.argv[1];
  if (!entry) return false;
  return fileURLToPath(import.meta.url) === entry;
}

if (isDirectRun()) {
  const distDir = process.argv[2];
  const expectedChainId = process.argv[3];
  if (!distDir || !expectedChainId) {
    console.error("usage: assertBuiltChain.mjs <dist-dir> <chain-id>");
    process.exit(2);
  }
  try {
    const result = assertBundleChain(readDistSource(distDir), expectedChainId);
    if (!result.ok) {
      console.error(result.message);
      process.exit(1);
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

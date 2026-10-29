import assert from "node:assert/strict";
import test from "node:test";

import {
  LOCAL_CHAIN_ID,
  LOCAL_POOL_TOKEN_ADDRESS_VARIABLES,
  LOCAL_RPC_URL,
  SEPOLIA_CHAIN_ID,
  SEPOLIA_EXPLORER_URL,
  SEPOLIA_RPC_URL,
  SEPOLIA_TOKEN0_ADDRESS,
  SEPOLIA_TOKEN1_ADDRESS,
  localPoolTokenAddressErrorMessage,
  parseChainId,
  resolveChainId,
  resolveChainLabel,
  resolveChainName,
  resolveExplorerUrl,
  resolveDemoMode,
  resolvePoolTokenAddresses,
  resolveRpcUrl,
} from "./chainEnv.ts";

test("an unset or blank chain id keeps the build on Sepolia", () => {
  assert.equal(resolveChainId(undefined), SEPOLIA_CHAIN_ID);
  assert.equal(resolveChainId(""), SEPOLIA_CHAIN_ID);
  assert.equal(resolveChainId("   "), SEPOLIA_CHAIN_ID);
});

test("a malformed chain id does not silently become the local chain", () => {
  for (const value of ["abc", "0x7a69", "-1", "1.5", "31337x", "0"]) {
    assert.equal(parseChainId(value), null, `expected ${value} to be rejected`);
    assert.equal(resolveChainId(value), SEPOLIA_CHAIN_ID);
  }
});

test("a decimal 31337 selects the local chain", () => {
  assert.equal(parseChainId("31337"), LOCAL_CHAIN_ID);
  assert.equal(resolveChainId(" 31337 "), LOCAL_CHAIN_ID);
});

test("the RPC falls back per chain and honours an explicit override", () => {
  assert.equal(resolveRpcUrl(undefined, SEPOLIA_CHAIN_ID), SEPOLIA_RPC_URL);
  assert.equal(resolveRpcUrl(undefined, LOCAL_CHAIN_ID), LOCAL_RPC_URL);
  assert.equal(
    resolveRpcUrl("http://rpc.internal:8545", LOCAL_CHAIN_ID),
    "http://rpc.internal:8545",
  );
  // A blank value is treated as absent, not as an empty URL.
  assert.equal(resolveRpcUrl("  ", LOCAL_CHAIN_ID), LOCAL_RPC_URL);
});

test("a local chain has no explorer unless one is configured", () => {
  assert.equal(resolveExplorerUrl(undefined, SEPOLIA_CHAIN_ID), SEPOLIA_EXPLORER_URL);
  assert.equal(resolveExplorerUrl(undefined, LOCAL_CHAIN_ID), null);
  assert.equal(
    resolveExplorerUrl("http://localhost:5100", LOCAL_CHAIN_ID),
    "http://localhost:5100",
  );
});

test("chain labels distinguish the local stack from Sepolia", () => {
  assert.equal(resolveChainLabel(SEPOLIA_CHAIN_ID), "Sepolia · 11155111");
  assert.equal(resolveChainLabel(LOCAL_CHAIN_ID), "Anvil Local · 31337");
  assert.equal(resolveChainName(SEPOLIA_CHAIN_ID), "Sepolia");
  assert.equal(resolveChainName(LOCAL_CHAIN_ID), "Anvil Local");
});

test("Sepolia resolves its published pool tokens with no environment at all", () => {
  const resolved = resolvePoolTokenAddresses({
    chainId: SEPOLIA_CHAIN_ID,
    token0: undefined,
    token1: undefined,
  });

  assert.equal(resolved.status, "configured");
  assert.equal(resolved.addresses.token0, SEPOLIA_TOKEN0_ADDRESS);
  assert.equal(resolved.addresses.token1, SEPOLIA_TOKEN1_ADDRESS);
  // The chain id a no-env build resolves to is Sepolia, which is what makes the
  // defaults above reachable without any VITE_* variable.
  assert.equal(resolveChainId(undefined), SEPOLIA_CHAIN_ID);
});

test("a blank Sepolia override is ignored rather than becoming an empty address", () => {
  const resolved = resolvePoolTokenAddresses({
    chainId: SEPOLIA_CHAIN_ID,
    token0: "   ",
    token1: "",
  });

  assert.equal(resolved.status, "configured");
  assert.equal(resolved.addresses.token0, SEPOLIA_TOKEN0_ADDRESS);
  assert.equal(resolved.addresses.token1, SEPOLIA_TOKEN1_ADDRESS);
});

test("the local chain without both token addresses is unconfigured, not defaulted", () => {
  const bothMissing = resolvePoolTokenAddresses({
    chainId: LOCAL_CHAIN_ID,
    token0: undefined,
    token1: undefined,
  });

  assert.equal(bothMissing.status, "unconfigured");
  assert.deepEqual(bothMissing.missingVariables, [
    "VITE_TOKEN0_ADDRESS",
    "VITE_TOKEN1_ADDRESS",
  ]);
  // No address at all: not a zero address, not the Sepolia value, not a
  // placeholder string. There is nothing for a caller to read by mistake.
  assert.equal("addresses" in bothMissing, false);
  assert.deepEqual(LOCAL_POOL_TOKEN_ADDRESS_VARIABLES, [
    "VITE_TOKEN0_ADDRESS",
    "VITE_TOKEN1_ADDRESS",
  ]);
});

test("one missing local token address names exactly that variable", () => {
  const noToken0 = resolvePoolTokenAddresses({
    chainId: LOCAL_CHAIN_ID,
    token0: undefined,
    token1: "0xB7f8BC63BbcaD18155201308C8f3540b07f84F5e",
  });
  assert.equal(noToken0.status, "unconfigured");
  assert.deepEqual(noToken0.missingVariables, ["VITE_TOKEN0_ADDRESS"]);

  const noToken1 = resolvePoolTokenAddresses({
    chainId: LOCAL_CHAIN_ID,
    token0: "0x610178dA211FEF7D417bC0e6FeD39F05609AD788",
    token1: "  ",
  });
  assert.equal(noToken1.status, "unconfigured");
  assert.deepEqual(noToken1.missingVariables, ["VITE_TOKEN1_ADDRESS"]);
});

test("the local unconfigured message names the variables and the chain", () => {
  const message = localPoolTokenAddressErrorMessage([
    "VITE_TOKEN0_ADDRESS",
    "VITE_TOKEN1_ADDRESS",
  ]);

  assert.match(message, /31337/);
  assert.match(message, /VITE_TOKEN0_ADDRESS/);
  assert.match(message, /VITE_TOKEN1_ADDRESS/);
  assert.match(message, /required/);
  // It points at the one place that supplies them rather than implying a
  // default exists somewhere.
  assert.match(message, /docker-compose/);

  // Singular wording stays grammatical.
  const single = localPoolTokenAddressErrorMessage(["VITE_TOKEN1_ADDRESS"]);
  assert.match(single, /VITE_TOKEN1_ADDRESS is required/);
});

test("the local chain uses the supplied token addresses when present", () => {
  const token0 = "0x610178dA211FEF7D417bC0e6FeD39F05609AD788";
  const token1 = "0xB7f8BC63BbcaD18155201308C8f3540b07f84F5e";
  const resolved = resolvePoolTokenAddresses({
    chainId: LOCAL_CHAIN_ID,
    token0,
    token1,
  });

  assert.equal(resolved.status, "configured");
  assert.equal(resolved.addresses.token0, token0);
  assert.equal(resolved.addresses.token1, token1);
});

test("local overrides are trimmed and take precedence over Sepolia defaults", () => {
  const resolved = resolvePoolTokenAddresses({
    chainId: LOCAL_CHAIN_ID,
    token0: "  0x610178dA211FEF7D417bC0e6FeD39F05609AD788  ",
    token1: "0xB7f8BC63BbcaD18155201308C8f3540b07f84F5e",
  });

  assert.equal(resolved.status, "configured");
  assert.equal(
    resolved.addresses.token0,
    "0x610178dA211FEF7D417bC0e6FeD39F05609AD788",
  );
  // The Sepolia values are never reachable on the local chain.
  assert.notEqual(resolved.addresses.token0, SEPOLIA_TOKEN0_ADDRESS);
  assert.notEqual(resolved.addresses.token1, SEPOLIA_TOKEN1_ADDRESS);
});

// ---------------------------------------------------------------------------
// Demo-mode resolution
// ---------------------------------------------------------------------------

test("demo mode needs the flag on every chain", () => {
  for (const flagValue of [undefined, "", "false", "TRUE", "1", " true!"]) {
    assert.equal(
      resolveDemoMode({
        chainId: LOCAL_CHAIN_ID,
        devBuild: true,
        flagValue,
      }),
      false,
      `flag ${JSON.stringify(flagValue)} must not enable demo mode`,
    );
  }
});

test("Sepolia demo mode still requires the dev server", () => {
  assert.equal(
    resolveDemoMode({
      chainId: SEPOLIA_CHAIN_ID,
      devBuild: true,
      flagValue: "true",
    }),
    true,
  );
  // The property the production image relies on: a built Sepolia bundle can
  // never reach the demo signing path, however the flag is set.
  assert.equal(
    resolveDemoMode({
      chainId: SEPOLIA_CHAIN_ID,
      devBuild: false,
      flagValue: "true",
    }),
    false,
  );
});

test("the local chain may enable demo mode from a built bundle", () => {
  assert.equal(
    resolveDemoMode({
      chainId: LOCAL_CHAIN_ID,
      devBuild: false,
      flagValue: "true",
    }),
    true,
  );
});

test("the local dev server keeps demo mode working as before", () => {
  assert.equal(
    resolveDemoMode({
      chainId: LOCAL_CHAIN_ID,
      devBuild: true,
      flagValue: "true",
    }),
    true,
  );
});

test("a chain that is neither Sepolia nor local follows the dev-server rule", () => {
  assert.equal(
    resolveDemoMode({ chainId: 8453, devBuild: false, flagValue: "true" }),
    false,
  );
  assert.equal(
    resolveDemoMode({ chainId: 8453, devBuild: true, flagValue: "true" }),
    true,
  );
});

import assert from "node:assert/strict";
import test from "node:test";

import {
  LOCAL_CHAIN_ID,
  LOCAL_RPC_URL,
  SEPOLIA_CHAIN_ID,
  SEPOLIA_EXPLORER_URL,
  SEPOLIA_RPC_URL,
  parseChainId,
  resolveChainId,
  resolveChainLabel,
  resolveChainName,
  resolveExplorerUrl,
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

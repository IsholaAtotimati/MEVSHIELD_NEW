import assert from "node:assert/strict";
import test from "node:test";
import { privateKeyToAccount } from "viem/accounts";

import { LOCAL_CHAIN_ID, SEPOLIA_CHAIN_ID, resolveChainId, resolveChainLabel } from "../config/chainEnv.ts";
import {
  ANVIL_ACCOUNT_ADDRESS,
  ANVIL_ACCOUNT_KEY,
  WALLET_ERROR,
  WALLET_STATUS,
  injectedWalletMissingMessage,
  planConnectAnvil,
  planConnectWallet,
  showsAnvilAccountButton,
} from "./walletConnect.ts";

test("the published anvil key is account #0 and nothing else", () => {
  assert.equal(
    privateKeyToAccount(ANVIL_ACCOUNT_KEY).address,
    ANVIL_ACCOUNT_ADDRESS,
  );
  assert.equal(
    ANVIL_ACCOUNT_ADDRESS,
    "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
  );
});

test("a chain 31337 bundle with no browser wallet uses the anvil account", () => {
  assert.deepEqual(
    planConnectWallet({
      chainId: LOCAL_CHAIN_ID,
      hasInjectedProvider: false,
    }),
    { kind: "anvil" },
  );
  assert.equal(showsAnvilAccountButton(LOCAL_CHAIN_ID, false), true);
  assert.equal(resolveChainLabel(LOCAL_CHAIN_ID), "Anvil Local · 31337");
  assert.equal(
    injectedWalletMissingMessage(LOCAL_CHAIN_ID),
    WALLET_ERROR.injectedMissingLocal,
  );
});

test("a browser wallet on the local chain is used and the anvil key is not", () => {
  assert.deepEqual(
    planConnectWallet({
      chainId: LOCAL_CHAIN_ID,
      hasInjectedProvider: true,
    }),
    { kind: "injected" },
  );
});

test("the anvil button hides once an account is connected", () => {
  assert.equal(showsAnvilAccountButton(LOCAL_CHAIN_ID, true), false);
});

test("Use anvil account is allowed only on chain 31337", () => {
  assert.deepEqual(planConnectAnvil(LOCAL_CHAIN_ID), { kind: "anvil" });
  assert.deepEqual(planConnectAnvil(SEPOLIA_CHAIN_ID), {
    kind: "refuse",
    message: WALLET_ERROR.anvilLocalOnly,
  });
  assert.deepEqual(planConnectAnvil(1), {
    kind: "refuse",
    message: WALLET_ERROR.anvilLocalOnly,
  });
});

test("a Sepolia build with no browser wallet does not use the anvil account", () => {
  // This is the regression: a bare `npm run build` leaves VITE_CHAIN_ID unset,
  // resolveChainId returns Sepolia, and Connect wallet asks for an extension.
  const chainId = resolveChainId(undefined);
  assert.equal(chainId, SEPOLIA_CHAIN_ID);
  assert.equal(resolveChainLabel(chainId), "Sepolia · 11155111");
  assert.deepEqual(
    planConnectWallet({ chainId, hasInjectedProvider: false }),
    { kind: "refuse", message: WALLET_ERROR.browserRequired },
  );
  assert.equal(showsAnvilAccountButton(chainId, false), false);
  assert.equal(planConnectAnvil(chainId).kind, "refuse");
  assert.equal(
    injectedWalletMissingMessage(chainId),
    WALLET_ERROR.injectedMissingOther,
  );
});

test("chain id 1 is not the local anvil chain", () => {
  assert.notEqual(1, LOCAL_CHAIN_ID);
  assert.equal(resolveChainId("1"), 1);
  assert.deepEqual(
    planConnectWallet({ chainId: 1, hasInjectedProvider: false }),
    { kind: "refuse", message: WALLET_ERROR.browserRequired },
  );
  assert.equal(showsAnvilAccountButton(1, false), false);
  assert.equal(resolveChainLabel(1).startsWith("Anvil Local"), false);
});

test("explicit Sepolia and a blank chain id take the same wallet path", () => {
  for (const chainId of [resolveChainId("11155111"), resolveChainId(""), resolveChainId("   ")]) {
    assert.equal(chainId, SEPOLIA_CHAIN_ID);
    assert.equal(
      planConnectWallet({ chainId, hasInjectedProvider: false }).kind,
      "refuse",
    );
  }
});

test("a malformed chain id stays on the Sepolia wallet path", () => {
  const chainId = resolveChainId("31337x");
  assert.equal(chainId, SEPOLIA_CHAIN_ID);
  assert.equal(
    planConnectWallet({ chainId, hasInjectedProvider: false }).message,
    "Install a browser wallet, then click Connect wallet again.",
  );
});

test("an injected provider on Sepolia connects that wallet", () => {
  assert.deepEqual(
    planConnectWallet({
      chainId: SEPOLIA_CHAIN_ID,
      hasInjectedProvider: true,
    }),
    { kind: "injected" },
  );
});

test("status strings the top bar renders stay stable", () => {
  assert.equal(WALLET_STATUS.anvil, "Using the local anvil account");
  assert.equal(WALLET_STATUS.connected, "Wallet connected");
  assert.equal(WALLET_STATUS.disconnected, "Wallet not connected");
  assert.equal(
    WALLET_ERROR.browserRequired,
    "Install a browser wallet, then click Connect wallet again.",
  );
  assert.equal(WALLET_ERROR.noAccount, "The wallet did not return an account.");
});

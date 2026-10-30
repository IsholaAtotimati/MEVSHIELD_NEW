import assert from "node:assert/strict";
import test from "node:test";

import { WALLET_ERROR, WALLET_STATUS } from "./walletConnect.ts";
import { LOCAL_CHAIN_ID, SEPOLIA_CHAIN_ID } from "../config/chainEnv.ts";
import {
  TRADE_PATH,
  landingAction,
  landingLimit,
  pathAfterConnect,
  policyLifetimeLabel,
  showsLandingWalletStatus,
} from "./landingAction.ts";

const ACCOUNT = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";

test("no account offers Connect wallet", () => {
  assert.deepEqual(landingAction(null), {
    kind: "connect",
    label: "Connect wallet",
  });
  assert.equal(pathAfterConnect(null), null);
});

test("an account offers Enter app and a path to the trade page", () => {
  assert.deepEqual(landingAction(ACCOUNT), {
    kind: "enter",
    label: "Enter app",
    to: TRADE_PATH,
  });
  assert.equal(TRADE_PATH, "/trade");
  assert.equal(pathAfterConnect(ACCOUNT), "/trade");
});

test("the policy lifetime label is the shared TTL in minutes", () => {
  assert.equal(policyLifetimeLabel(10 * 60), "10 min");
  assert.equal(policyLifetimeLabel(90), "2 min");
});

test("the limit line names Sepolia on the public chain and anvil on the local chain", () => {
  assert.match(landingLimit(SEPOLIA_CHAIN_ID), /Sepolia testnet/);
  assert.match(landingLimit(SEPOLIA_CHAIN_ID), /execute path stays closed/);
  assert.match(landingLimit(LOCAL_CHAIN_ID), /Local anvil/);
  assert.doesNotMatch(landingLimit(LOCAL_CHAIN_ID), /Sepolia/);
});

test("the landing status line shows a refusal and hides idle and success", () => {
  assert.equal(showsLandingWalletStatus(WALLET_STATUS.disconnected), false);
  assert.equal(showsLandingWalletStatus(WALLET_STATUS.connecting), false);
  assert.equal(showsLandingWalletStatus(WALLET_STATUS.connected), false);
  assert.equal(showsLandingWalletStatus(WALLET_STATUS.anvil), false);
  assert.equal(showsLandingWalletStatus(WALLET_STATUS.failed), true);
  assert.equal(showsLandingWalletStatus(WALLET_ERROR.browserRequired), true);
});

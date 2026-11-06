import assert from "node:assert/strict";
import test from "node:test";

import { parseWalletChainId } from "../lib/walletChainId.ts";

test("wallet chain-change events parse valid hexadecimal chain IDs", () => {
  assert.equal(parseWalletChainId("0xaa36a7"), 11155111);
  assert.equal(parseWalletChainId("0x1"), 1);
});

test("wallet chain-change events reject malformed or unsafe chain IDs", () => {
  assert.equal(parseWalletChainId("11155111"), null);
  assert.equal(parseWalletChainId("0x0"), null);
  assert.equal(parseWalletChainId("0xnothex"), null);
  assert.equal(parseWalletChainId("0x20000000000000"), null);
  assert.equal(parseWalletChainId(11155111), null);
});

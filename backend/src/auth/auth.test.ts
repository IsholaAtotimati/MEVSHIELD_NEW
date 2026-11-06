import assert from "node:assert/strict";
import test from "node:test";
import { Wallet } from "ethers";

import { AuthService } from "./auth.js";
import {
  MemoryStateBackend,
  MemoryStateStore,
} from "../state/stateStore.js";

const wallet = new Wallet(
  "0x1111111111111111111111111111111111111111111111111111111111111111",
);
const otherWallet = new Wallet(
  "0x2222222222222222222222222222222222222222222222222222222222222222",
);
const origin = "https://mevshield.example";

test("SIWE authentication verifies the wallet, domain, and chain and issues a session", async () => {
  const service = new AuthService(
    { chainId: 11155111, applicationOrigin: origin },
    new MemoryStateStore(undefined, () => 0),
  );
  const nonce = await service.issueNonce(wallet.address, 1_000);
  const signature = await wallet.signMessage(nonce.message);

  const result = await service.verify(nonce.message, signature, 1_001);
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal((await service.getSession(result.token, 1_002))?.address, wallet.address);
  }
});

test("invalid, expired, and replayed authentication messages fail closed", async () => {
  const service = new AuthService(
    {
      chainId: 11155111,
      applicationOrigin: origin,
      nonceTtlMs: 100,
      sessionTtlMs: 100,
    },
    new MemoryStateStore(undefined, () => 0),
  );
  const nonce = await service.issueNonce(wallet.address, 1_000);
  const signature = await wallet.signMessage(nonce.message);

  assert.equal((await service.verify(nonce.message, signature, 1_101)).ok, false);

  const fresh = await service.issueNonce(wallet.address, 2_000);
  const invalid = await service.verify(
    fresh.message,
    await otherWallet.signMessage(fresh.message),
    2_001,
  );
  assert.equal(invalid.ok, false);
  assert.equal((await service.verify(fresh.message, await wallet.signMessage(fresh.message), 2_002)).ok, false);

  const sessionNonce = await service.issueNonce(wallet.address, 3_000);
  const authenticated = await service.verify(
    sessionNonce.message,
    await wallet.signMessage(sessionNonce.message),
    3_001,
  );
  assert.equal(authenticated.ok, true);
  if (authenticated.ok) {
    assert.equal((await service.getSession(authenticated.token, 3_050))?.address, wallet.address);
    assert.equal(await service.getSession(authenticated.token, 3_101), null);
    assert.equal(await service.getSession("malformed", 3_050), null);
  }

  const replayable = await service.issueNonce(wallet.address, 4_000);
  const replaySignature = await wallet.signMessage(replayable.message);
  assert.equal((await service.verify(replayable.message, replaySignature, 4_001)).ok, true);
  assert.equal((await service.verify(replayable.message, replaySignature, 4_002)).ok, false);
});

test("authentication rejects messages for a different domain or chain", async () => {
  const service = new AuthService(
    { chainId: 11155111, applicationOrigin: origin },
    new MemoryStateStore(),
  );
  const domainNonce = await service.issueNonce(wallet.address, 1_000);
  const wrongDomain = domainNonce.message.replace(
    "mevshield.example wants you",
    "attacker.example wants you",
  );
  assert.equal(
    (await service.verify(wrongDomain, await wallet.signMessage(wrongDomain), 1_001)).ok,
    false,
  );

  const chainNonce = await service.issueNonce(wallet.address, 2_000);
  const wrongChain = chainNonce.message.replace("Chain ID: 11155111", "Chain ID: 1");
  assert.equal(
    (await service.verify(wrongChain, await wallet.signMessage(wrongChain), 2_001)).ok,
    false,
  );
});

test("shared rate limiter enforces bounded windows across store instances", async () => {
  const backend = new MemoryStateBackend();
  let now = 0;
  const first = new MemoryStateStore(backend, () => now);
  const second = new MemoryStateStore(backend, () => now);
  assert.equal((await first.consumeRateLimit("wallet:a", 1_000, 2)).ok, true);
  assert.equal((await second.consumeRateLimit("wallet:a", 1_000, 2)).ok, true);
  const rejected = await first.consumeRateLimit("wallet:a", 1_000, 2);
  assert.equal(rejected.ok, false);
  if (!rejected.ok) assert.equal(rejected.retryAfterSeconds, 1);
  now = 1_001;
  assert.equal((await second.consumeRateLimit("wallet:a", 1_000, 2)).ok, true);
});

test("SIWE nonce consumption and session lookup work across service instances", async () => {
  const backend = new MemoryStateBackend();
  const first = new AuthService(
    { chainId: 11155111, applicationOrigin: origin },
    new MemoryStateStore(backend),
  );
  const second = new AuthService(
    { chainId: 11155111, applicationOrigin: origin },
    new MemoryStateStore(backend),
  );
  const nonce = await first.issueNonce(wallet.address);
  const signature = await wallet.signMessage(nonce.message);
  const [verified, replay] = await Promise.all([
    first.verify(nonce.message, signature),
    second.verify(nonce.message, signature),
  ]);
  assert.equal([verified, replay].filter((result) => result.ok).length, 1);
  const authenticated = verified.ok ? verified : replay;
  assert.equal(
    (await (verified.ok ? second : first).getSession(authenticated.ok ? authenticated.token : undefined))?.address,
    wallet.address,
  );
});

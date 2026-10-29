import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { assertBundleChain, builtChainMarker, findBuiltChainMarkers } from "./assertBuiltChain.mjs";
import { decideBundleBuild, LOCAL_TEST_CHAIN_ID } from "./localBundleGuard.mjs";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));

test("an unset chain marker is not anvil", () => {
  assert.equal(builtChainMarker(undefined), "mevshield-built-chain:unset");
  assert.equal(builtChainMarker(""), "mevshield-built-chain:unset");
  assert.equal(builtChainMarker("   "), "mevshield-built-chain:unset");
  assert.equal(builtChainMarker("31337"), "mevshield-built-chain:31337");
  assert.equal(builtChainMarker(" 31337 "), "mevshield-built-chain:31337");
  assert.equal(builtChainMarker("11155111"), "mevshield-built-chain:11155111");
  assert.equal(builtChainMarker("1"), "mevshield-built-chain:1");
  assert.equal(builtChainMarker("31337x"), "mevshield-built-chain:invalid");
});

test("the bundle check accepts only a single 31337 marker", () => {
  const anvil = "prefix mevshield-built-chain:31337 suffix";
  assert.deepEqual(assertBundleChain(anvil, 31337), {
    ok: true,
    marker: "mevshield-built-chain:31337",
  });

  for (const source of [
    "mevshield-built-chain:unset",
    "mevshield-built-chain:11155111",
    "mevshield-built-chain:1",
    "mevshield-built-chain:invalid",
    "no marker here, but 31337 appears as the local chain constant",
    "mevshield-built-chain:31337 mevshield-built-chain:unset",
  ]) {
    const result = assertBundleChain(source, LOCAL_TEST_CHAIN_ID);
    assert.equal(result.ok, false, source);
    assert.match(result.message, /expected exactly mevshield-built-chain:31337/);
  }
});

test("a marker search does not treat a nearby 31337 as the baked chain", () => {
  const source = "qn=31337; label Anvil Local; mevshield-built-chain:unset";
  assert.deepEqual(findBuiltChainMarkers(source), ["mevshield-built-chain:unset"]);
});

test("a live local-test frontend blocks every build that is not chain 31337", () => {
  for (const viteChainId of [undefined, "", "   ", "11155111", "1", "31337x", "0x7a69"]) {
    const decision = decideBundleBuild({
      viteChainId,
      localTestFrontendRunning: true,
    });
    assert.equal(decision.allow, false, String(viteChainId));
    assert.match(decision.message, /Refusing to build frontend\/dist/);
    assert.match(decision.message, /local-test-flow\.sh/);
  }

  assert.deepEqual(
    decideBundleBuild({
      viteChainId: "31337",
      localTestFrontendRunning: true,
    }),
    { allow: true },
  );
  assert.deepEqual(
    decideBundleBuild({
      viteChainId: " 31337 ",
      localTestFrontendRunning: true,
    }),
    { allow: true },
  );
});

test("a stopped or absent local-test frontend still allows a Sepolia build", () => {
  for (const viteChainId of [undefined, "11155111", "1", "31337"]) {
    assert.deepEqual(
      decideBundleBuild({ viteChainId, localTestFrontendRunning: false }),
      { allow: true },
    );
  }
});

test("the frontend build and test scripts keep the lock wired", () => {
  const pkg = JSON.parse(
    readFileSync(new URL("../package.json", import.meta.url), "utf8"),
  );
  assert.match(pkg.scripts.build, /^node scripts\/localBundleGuard\.mjs && /);
  assert.match(pkg.scripts.test, /src\/lib\/walletConnect\.test\.mjs/);
  assert.match(pkg.scripts.test, /scripts\/localAnvilBundle\.test\.mjs/);
});

test("local-test-flow bakes chain 31337 and refuses to publish anything else", () => {
  const source = readFileSync(`${repoRoot}/script/local-test-flow.sh`, "utf8");
  const buildAt = source.indexOf("npm run build");
  assert.notEqual(buildAt, -1);
  const exportAt = source.lastIndexOf("export VITE_CHAIN_ID=31337", buildAt);
  assert.notEqual(exportAt, -1);
  assert.ok(exportAt < buildAt);
  assert.equal(source.includes("npm run build >/dev/null"), false);
  assert.match(source, /assertBuiltChain\.mjs/);
  assert.match(source, /assertBuiltChain\.mjs" "\$DIST_DIR" 31337/);
  assert.equal(source.includes("VITE_CHAIN_ID=11155111"), false);
  assert.equal(/VITE_CHAIN_ID=1(?!\d)/.test(source), false);
});

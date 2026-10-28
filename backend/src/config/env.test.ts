import assert from "node:assert/strict";
import test from "node:test";

import {
  firstConfigured,
  resolveHookAddress,
  resolveRegistryAddress,
  resolveRouterAddress,
  resolveSepoliaRpcUrl,
  resolveVerifierAddress,
} from "./env.js";

test("firstConfigured ignores unset, empty, and whitespace-only values", () => {
  assert.equal(firstConfigured(undefined, "", "   ", "0xabc"), "0xabc");
  assert.equal(firstConfigured("  trimmed  "), "trimmed");
  assert.equal(firstConfigured(undefined, ""), undefined);
  assert.equal(firstConfigured(), undefined);
});

test("router resolution prefers ROUTER_ADDRESS over the legacy alias", () => {
  assert.equal(
    resolveRouterAddress({
      ROUTER_ADDRESS: "0x1111111111111111111111111111111111111111",
      MEVSHIELD_ROUTER: "0x2222222222222222222222222222222222222222",
    }),
    "0x1111111111111111111111111111111111111111",
  );
  assert.equal(
    resolveRouterAddress({
      MEVSHIELD_ROUTER: "0x2222222222222222222222222222222222222222",
    }),
    "0x2222222222222222222222222222222222222222",
  );
  assert.equal(resolveRouterAddress({}), undefined);
});

test("verifier resolution walks POLICY_VERIFIER_ADDRESS, VERIFIER_ADDRESS, POLICY_VERIFIER", () => {
  const canonical = "0x1111111111111111111111111111111111111111";
  const alias = "0x2222222222222222222222222222222222222222";
  const legacy = "0x3333333333333333333333333333333333333333";

  assert.equal(
    resolveVerifierAddress({
      POLICY_VERIFIER_ADDRESS: canonical,
      VERIFIER_ADDRESS: alias,
      POLICY_VERIFIER: legacy,
    }),
    canonical,
  );
  assert.equal(
    resolveVerifierAddress({ VERIFIER_ADDRESS: alias, POLICY_VERIFIER: legacy }),
    alias,
  );
  assert.equal(resolveVerifierAddress({ POLICY_VERIFIER: legacy }), legacy);
  assert.equal(resolveVerifierAddress({}), undefined);
});

test("RPC resolution prefers SEPOLIA_RPC_URL over RPC_URL", () => {
  assert.equal(
    resolveSepoliaRpcUrl({
      SEPOLIA_RPC_URL: "https://sepolia.example",
      RPC_URL: "https://generic.example",
    }),
    "https://sepolia.example",
  );
  assert.equal(
    resolveSepoliaRpcUrl({ RPC_URL: "https://generic.example" }),
    "https://generic.example",
  );
  assert.equal(resolveSepoliaRpcUrl({}), undefined);
});

test("registry and hook resolution keep their legacy alias fallbacks", () => {
  assert.equal(
    resolveRegistryAddress({ POLICY_REGISTRY: "0xregistrylegacy" }),
    "0xregistrylegacy",
  );
  assert.equal(
    resolveRegistryAddress({
      POLICY_REGISTRY_ADDRESS: "0xregistry",
      POLICY_REGISTRY: "0xregistrylegacy",
    }),
    "0xregistry",
  );
  assert.equal(
    resolveHookAddress({ MEVSHIELD_HOOK_ADDRESS: "0xhooklegacy" }),
    "0xhooklegacy",
  );
  assert.equal(
    resolveHookAddress({
      HOOK_ADDRESS: "0xhook",
      MEVSHIELD_HOOK_ADDRESS: "0xhooklegacy",
    }),
    "0xhook",
  );
});

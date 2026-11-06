import { useCallback, useEffect, useState } from "react";

import { CHAIN_NAME } from "../config/chain";
import { CONTRACTS } from "../lib/contracts";
import {
  mevShieldHookAbi,
  policyAuthorizationAbi,
  policyRegistryAbi,
  policyVerifierAbi,
} from "../lib/abis";
import { publicClient } from "../lib/viem";
import type { DeploymentStatus } from "../lib/types";

const EMPTY_DEPLOYMENT: DeploymentStatus = {
  poolManager: null,
  routerPoolManager: null,
  routerHasCode: false,
  authorization: null,
  registry: null,
  registryOwner: null,
  authorizedConsumer: null,
  verifier: null,
  authorizedSigner: null,
};

const routerPoolManagerAbi = [
  {
    type: "function",
    name: "poolManager",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
  },
] as const;

export function useProtocol() {
  const [deployment, setDeployment] =
    useState<DeploymentStatus>(EMPTY_DEPLOYMENT);
  const [protocolStatus, setProtocolStatus] = useState(
    "Checking protocol...",
  );

  const loadProtocol = useCallback(async () => {
    try {
      const [
        poolManager,
        routerPoolManager,
        routerCode,
        authorization,
        registry,
        registryOwner,
        authorizedConsumer,
        verifier,
        authorizedSigner,
      ] = await Promise.all([
        publicClient.readContract({
          address: CONTRACTS.mevShieldHook,
          abi: mevShieldHookAbi,
          functionName: "poolManager",
        }),
        publicClient.readContract({
          address: CONTRACTS.mevShieldRouter,
          abi: routerPoolManagerAbi,
          functionName: "poolManager",
        }),
        publicClient.getCode({ address: CONTRACTS.mevShieldRouter }),
        publicClient.readContract({
          address: CONTRACTS.mevShieldHook,
          abi: mevShieldHookAbi,
          functionName: "authorization",
        }),
        publicClient.readContract({
          address: CONTRACTS.policyAuthorization,
          abi: policyAuthorizationAbi,
          functionName: "registry",
        }),
        publicClient.readContract({
          address: CONTRACTS.policyRegistry,
          abi: policyRegistryAbi,
          functionName: "owner",
        }),
        publicClient.readContract({
          address: CONTRACTS.policyRegistry,
          abi: policyRegistryAbi,
          functionName: "authorizedConsumer",
        }),
        publicClient.readContract({
          address: CONTRACTS.policyAuthorization,
          abi: policyAuthorizationAbi,
          functionName: "verifier",
        }),
        publicClient.readContract({
          address: CONTRACTS.policyVerifier,
          abi: policyVerifierAbi,
          functionName: "authorizedSigner",
        }),
      ]);

      setDeployment({
        poolManager,
        routerPoolManager,
        routerHasCode: Boolean(routerCode && routerCode !== "0x"),
        authorization,
        registry,
        registryOwner,
        authorizedConsumer,
        verifier,
        authorizedSigner,
      });
      setProtocolStatus("Protocol connected");
    } catch (error) {
      console.error(error);
      setProtocolStatus(
        `Could not connect to ${CHAIN_NAME}. Check your RPC connection.`,
      );
    }
  }, []);

  useEffect(() => {
    void loadProtocol();
    const interval = window.setInterval(() => void loadProtocol(), 15_000);
    return () => window.clearInterval(interval);
  }, [loadProtocol]);

  const hasAuthorization = Boolean(
    deployment.authorization &&
      deployment.authorizedConsumer?.toLowerCase() ===
        deployment.authorization.toLowerCase(),
  );

  const protocolAddressesVerified = Boolean(
    deployment.poolManager?.toLowerCase() ===
      CONTRACTS.poolManager.toLowerCase() &&
    deployment.routerHasCode &&
    deployment.routerPoolManager?.toLowerCase() ===
      CONTRACTS.poolManager.toLowerCase() &&
      deployment.authorization?.toLowerCase() ===
        CONTRACTS.poolAuthorization.toLowerCase() &&
      deployment.registry?.toLowerCase() ===
        CONTRACTS.policyRegistry.toLowerCase() &&
      deployment.verifier?.toLowerCase() ===
        CONTRACTS.policyVerifier.toLowerCase() &&
      deployment.authorizedSigner?.toLowerCase() ===
        CONTRACTS.authorizedSigner.toLowerCase(),
  );

  return {
    deployment,
    protocolStatus,
    loadProtocol,
    hasAuthorization,
    protocolAddressesVerified,
  };
}

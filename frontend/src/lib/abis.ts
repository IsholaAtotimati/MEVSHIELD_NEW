export const policyRegistryAbi = [
  {
    type: "function",
    name: "getPolicy",
    stateMutability: "view",
    inputs: [
      {
        name: "policyId",
        type: "bytes32",
      },
    ],
    outputs: [
      {
        name: "policy",
        type: "tuple",
        components: [
          { name: "poolId", type: "bytes32" },
          { name: "trader", type: "address" },
          { name: "nonce", type: "uint256" },
          { name: "expiry", type: "uint256" },
          { name: "maxLoss", type: "uint256" },
          { name: "maxFee", type: "uint256" },
        ],
      },
    ],
  },
  {
    type: "function",
    name: "isConsumed",
    stateMutability: "view",
    inputs: [
      { name: "trader", type: "address" },
      { name: "nonce", type: "uint256" },
    ],
    outputs: [
      { name: "", type: "bool" },
    ],
  },
  {
    type: "function",
    name: "isRegistered",
    stateMutability: "view",
    inputs: [
      { name: "trader", type: "address" },
      { name: "nonce", type: "uint256" },
    ],
    outputs: [
      { name: "", type: "bool" },
    ],
  },
] as const;

export const policyVerifierAbi = [
  {
    type: "function",
    name: "authorizedSigner",
    stateMutability: "view",
    inputs: [],
    outputs: [
      { name: "", type: "address" },
    ],
  },
] as const;

export const policyAuthorizationAbi = [
  {
    type: "function",
    name: "registry",
    stateMutability: "view",
    inputs: [],
    outputs: [
      { name: "", type: "address" },
    ],
  },
  {
    type: "function",
    name: "verifier",
    stateMutability: "view",
    inputs: [],
    outputs: [
      { name: "", type: "address" },
    ],
  },
] as const;

export const mevShieldHookAbi = [
  {
    type: "function",
    name: "poolManager",
    stateMutability: "view",
    inputs: [],
    outputs: [
      { name: "", type: "address" },
    ],
  },
  {
    type: "function",
    name: "authorization",
    stateMutability: "view",
    inputs: [],
    outputs: [
      { name: "", type: "address" },
    ],
  },
] as const;
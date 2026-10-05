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
    name: "registerPolicy",
    stateMutability: "nonpayable",
    inputs: [
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
          { name: "zeroForOne", type: "bool" },
          { name: "amountSpecified", type: "int256" },
          { name: "sqrtPriceLimitX96", type: "uint160" },
        ],
      },
      { name: "signature", type: "bytes" },
    ],
    outputs: [{ name: "policyId", type: "bytes32" }],
  },
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

export const mevShieldRouterAbi = [
  {
    type: "function",
    name: "executeSwap",
    stateMutability: "payable",
    inputs: [
      {
        name: "key",
        type: "tuple",
        components: [
          { name: "currency0", type: "address" },
          { name: "currency1", type: "address" },
          { name: "fee", type: "uint24" },
          { name: "tickSpacing", type: "int24" },
          { name: "hooks", type: "address" },
        ],
      },
      {
        name: "params",
        type: "tuple",
        components: [
          { name: "zeroForOne", type: "bool" },
          { name: "amountSpecified", type: "int256" },
          { name: "sqrtPriceLimitX96", type: "uint160" },
        ],
      },
      { name: "hookData", type: "bytes" },
      { name: "recipient", type: "address" },
    ],
    outputs: [{ name: "delta", type: "int256" }],
  },
] as const;

export const erc20Abi = [
  {
    type: "function",
    name: "allowance",
    stateMutability: "view",
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
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
export const CHAIN_ID = 31337;

export const ANVIL_CHAIN = {
  id: 31337,
  name: "Anvil",
  nativeCurrency: {
    name: "Ether",
    symbol: "ETH",
    decimals: 18,
  },
  rpcUrls: {
    default: {
      http: ["http://127.0.0.1:8545"],
    },
  },
} as const;

export const CONTRACTS = {
  poolManager: "0xF71F05eEe4D20d1E34805F89821CcE9A488b24bc",
  policyRegistry: "0xC662A0f4a422D5042d183DD0A53D164092Eb8b92",
  policyVerifier: "0xEd9D66b038e33989404D72F88c7220Ee395CBC9e",
  policyAuthorization: "0x57d1e2F2a638813824BB2A63Da5B78B891382940",
  mevShieldHook: "0x8ba326a0b7a7fE8b37152fA6F4DED83dAB630080",
} as const;
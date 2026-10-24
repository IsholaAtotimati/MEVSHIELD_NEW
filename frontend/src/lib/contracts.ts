export const CHAIN_ID = 11155111;

export const SEPOLIA_CHAIN ={
  id: 11155111,
  name: "Sepolia",
  nativeCurrency: {
    name: "Sepolia Ether",
    symbol: "ETH",
    decimals: 18,
  },
  rpcUrls: {
    default: {
      http: ["https://ethereum-sepolia-rpc.publicnode.com"],
    },
  },
} as const;

export const CONTRACTS = {
  poolManager:
    "0xE03A1074c86CFeDd5C142C4F04F1a1536e203543",

  policyRegistry:
    "0xB2897da1CfC0c73C3983221a87C27586D1cE1c9E",

  policyVerifier:
    "0x716f9315BC9c2AB98a82DDE78ca86887Ab61b79f",

  policyAuthorization:
    "0xefC9bc21f1ab3564232a3216f0e45d5caE3Bd7c5",

  poolAuthorization:
    "0xefC9bc21f1ab3564232a3216f0e45d5caE3Bd7c5",

  mevShieldHook:
    "0xd15e4fdd391a68c2f1c385d1a819117a3ad40080",

  mevShieldRouter:
    "0x633282608B2fc66cD7572f5eF58e804063aa150D",

  authorizedSigner:
    "0x016B78a30CE176EF0B90c122e8677e13aAB2A815",
} as const;

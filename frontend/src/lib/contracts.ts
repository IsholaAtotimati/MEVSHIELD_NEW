export const CHAIN_ID = 11155111;

export const SEPOLIA_CHAIN = {
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
    "0xC57DE7312B9e90f29bAdE0d1944f6A73f5FC7365",

  policyVerifier:
    "0x9DF6c29bD323B61f83f1D3214041bf08f1267544",

  policyAuthorization:
    "0x415fde3E9a373f2c482a90dB069ccf4A2d215304",

  mevShieldHook:
    "0x9Db919582f4751d3d0Fc8C38D15a717da9E54080",

  mevShieldRouter:
    "0xE57525678cbf6417F685727b77551316a3De3bba",
} as const;

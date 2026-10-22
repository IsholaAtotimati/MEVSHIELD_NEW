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
    "0x7fB5530fc4fD7838975343C5Fd2DB6e4b16A9503",

  policyVerifier:
    "0x9C8c0E55894CF126cE62cAE76A02aec85F6c60d8",

  policyAuthorization:
    "0xC391f4D4820960B21fAf6D547341bC3b4aFe78D6",

  poolAuthorization:
    "0xC391f4D4820960B21fAf6D547341bC3b4aFe78D6",

  mevShieldHook:
    "0x5446D8C7568fC9bb9e699Ae94CFD47533118C080",

  mevShieldRouter:
    "0xF5daE9fbB66de969733779B090392CcD994b275b",

  authorizedSigner:
    "0x016B78a30CE176EF0B90c122e8677e13aAB2A815",
} as const;

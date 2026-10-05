import {
  AbiCoder,
  Contract,
  JsonRpcProvider,
  Wallet,
  keccak256,
} from "ethers";

const REGISTRY_ABI = [
  "function getPolicy(bytes32 policyId) external view returns (tuple(bytes32 poolId,address trader,uint256 nonce,uint256 expiry,uint256 maxLoss,uint256 maxFee))",
  "function isRegistered(address trader,uint256 nonce) external view returns (bool)",
  "function isConsumed(address trader,uint256 nonce) external view returns (bool)",
];

const ROUTER_ABI = [
  "function executeSwap((address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks),(bool zeroForOne,int256 amountSpecified,uint160 sqrtPriceLimitX96),bytes hookData,address recipient) payable returns (int256 amount0,int256 amount1)",
];

export type PoolKey = {
  currency0: string;
  currency1: string;
  fee: number;
  tickSpacing: number;
  hooks: string;
};

export type SwapParams = {
  zeroForOne: boolean;
  amountSpecified: bigint;
  sqrtPriceLimitX96: bigint;
};

export class MEVShieldClient {
  private readonly provider: JsonRpcProvider;
  private readonly wallet: Wallet;
  private readonly registry: Contract;
  private readonly router: Contract;

  constructor() {
    const rpcUrl = process.env.RPC_URL ?? "http://127.0.0.1:8545";
    const privateKey = process.env.DEPLOYER_PRIVATE_KEY?.trim();
    const registryAddress = process.env.POLICY_REGISTRY;
    const routerAddress = process.env.MEVSHIELD_ROUTER;

    if (!privateKey) {
      throw new Error("DEPLOYER_PRIVATE_KEY is not set");
    }

    if (!registryAddress) {
      throw new Error("POLICY_REGISTRY is not set");
    }

    if (!routerAddress) {
      throw new Error("MEVSHIELD_ROUTER is not set");
    }

    this.provider = new JsonRpcProvider(rpcUrl);
    this.wallet = new Wallet(privateKey, this.provider);

    this.registry = new Contract(
      registryAddress,
      REGISTRY_ABI,
      this.wallet
    );

    this.router = new Contract(
      routerAddress,
      ROUTER_ABI,
      this.wallet
    );
  }

  static policyId(
    poolId: string,
    trader: string,
    nonce: bigint
  ): string {
    const encoded = AbiCoder.defaultAbiCoder().encode(
      ["bytes32", "address", "uint256"],
      [poolId, trader, nonce]
    );

    return keccak256(encoded);
  }

  async executeSwap(
    poolKey: PoolKey,
    swapParams: SwapParams,
    hookData: string,
    recipient: string
  ): Promise<{
    txHash: string;
    blockNumber: number;
  }> {
    const tx = await this.router.executeSwap(
      [
        poolKey.currency0,
        poolKey.currency1,
        poolKey.fee,
        poolKey.tickSpacing,
        poolKey.hooks,
      ],
      [
        swapParams.zeroForOne,
        swapParams.amountSpecified,
        swapParams.sqrtPriceLimitX96,
      ],
      hookData,
      recipient
    );

    const receipt = await tx.wait();

    if (!receipt) {
      throw new Error("Swap transaction was not mined");
    }

    return {
      txHash: receipt.hash,
      blockNumber: receipt.blockNumber,
    };
  }

  async isRegistered(
    trader: string,
    nonce: bigint
  ): Promise<boolean> {
    return await this.registry.isRegistered(trader, nonce);
  }

  async isConsumed(
    trader: string,
    nonce: bigint
  ): Promise<boolean> {
    return await this.registry.isConsumed(trader, nonce);
  }

  async getPolicy(policyId: string) {
    return await this.registry.getPolicy(policyId);
  }

  async signerAddress(): Promise<string> {
    return await this.wallet.getAddress();
  }
}
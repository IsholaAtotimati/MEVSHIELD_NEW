import { AbiCoder, Contract, JsonRpcProvider, Wallet, keccak256, } from "ethers";
const REGISTRY_ABI = [
    "function registerPolicy(bytes32 poolId,address trader,uint256 nonce,uint256 expiry,uint256 maxLoss,uint256 maxFee) external",
    "function getPolicy(bytes32 policyId) external view returns (tuple(bytes32 poolId,address trader,uint256 nonce,uint256 expiry,uint256 maxLoss,uint256 maxFee))",
    "function isRegistered(address trader,uint256 nonce) external view returns (bool)",
    "function isConsumed(address trader,uint256 nonce) external view returns (bool)",
];
const ROUTER_ABI = [
    "function executeSwap((address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks),(bool zeroForOne,int256 amountSpecified,uint160 sqrtPriceLimitX96),bytes hookData,address recipient) payable returns (int256 amount0,int256 amount1)",
];
export class MEVShieldClient {
    provider;
    wallet;
    registry;
    router;
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
        this.registry = new Contract(registryAddress, REGISTRY_ABI, this.wallet);
        this.router = new Contract(routerAddress, ROUTER_ABI, this.wallet);
    }
    static policyId(poolId, trader, nonce) {
        const encoded = AbiCoder.defaultAbiCoder().encode(["bytes32", "address", "uint256"], [poolId, trader, nonce]);
        return keccak256(encoded);
    }
    async registerPolicy(poolId, trader, nonce, expiry, maxLoss, maxFee) {
        const tx = await this.registry.registerPolicy(poolId, trader, nonce, expiry, maxLoss, maxFee);
        const receipt = await tx.wait();
        if (!receipt) {
            throw new Error("Policy registration transaction was not mined");
        }
        return receipt.hash;
    }
    async executeSwap(poolKey, swapParams, hookData, recipient) {
        const tx = await this.router.executeSwap([
            poolKey.currency0,
            poolKey.currency1,
            poolKey.fee,
            poolKey.tickSpacing,
            poolKey.hooks,
        ], [
            swapParams.zeroForOne,
            swapParams.amountSpecified,
            swapParams.sqrtPriceLimitX96,
        ], hookData, recipient);
        const receipt = await tx.wait();
        if (!receipt) {
            throw new Error("Swap transaction was not mined");
        }
        return {
            txHash: receipt.hash,
            blockNumber: receipt.blockNumber,
        };
    }
    async isRegistered(trader, nonce) {
        return await this.registry.isRegistered(trader, nonce);
    }
    async isConsumed(trader, nonce) {
        return await this.registry.isConsumed(trader, nonce);
    }
    async getPolicy(policyId) {
        return await this.registry.getPolicy(policyId);
    }
    async signerAddress() {
        return await this.wallet.getAddress();
    }
}

import { Wallet, verifyTypedData, TypedDataEncoder } from "ethers";
import { signPolicy } from "./policySigner.js";
const signerPrivateKey = "0x00000000000000000000000000000000000000000000000000000000000A11CE";
const wallet = new Wallet(signerPrivateKey);
const policy = {
    poolId: "0x" +
        "0".repeat(64), // temporary; replaced below
    trader: "0x0000000000000000000000000000000000001234",
    nonce: 1n,
    // Same logical value as the Solidity test:
    // block.timestamp + 1 hours.
    // We use a fixed future timestamp for deterministic off-chain testing.
    expiry: 3601n,
    maxLoss: 100n,
    maxFee: 5n,
    zeroForOne: true,
    amountSpecified: -100000000n,
    sqrtPriceLimitX96: 79228162514264337593543950336n
};
// Solidity:
// keccak256("ETH/USDC")
//
// We calculate it here rather than manually guessing the bytes32 value.
import { keccak256, toUtf8Bytes } from "ethers";
policy.poolId = keccak256(toUtf8Bytes("ETH/USDC"));
const config = {
    chainId: 31337,
    verifyingContract: "0x5615dEB798BB3E4dFa0139dFa1b3D433Cc23b72f"
};
const domain = {
    name: "MEVShield",
    version: "1",
    chainId: config.chainId,
    verifyingContract: config.verifyingContract
};
const types = {
    Policy: [
        { name: "poolId", type: "bytes32" },
        { name: "trader", type: "address" },
        { name: "nonce", type: "uint256" },
        { name: "expiry", type: "uint256" },
        { name: "maxLoss", type: "uint256" },
        { name: "maxFee", type: "uint256" },
        { name: "zeroForOne", type: "bool" },
        { name: "amountSpecified", type: "int256" },
        { name: "sqrtPriceLimitX96", type: "uint160" }
    ]
};
const signature = await signPolicy(wallet, policy, config);
const digest = TypedDataEncoder.hash(domain, types, {
    poolId: policy.poolId,
    trader: policy.trader,
    nonce: policy.nonce,
    expiry: policy.expiry,
    maxLoss: policy.maxLoss,
    maxFee: policy.maxFee,
    zeroForOne: policy.zeroForOne,
    amountSpecified: policy.amountSpecified,
    sqrtPriceLimitX96: policy.sqrtPriceLimitX96
});
const recovered = verifyTypedData(domain, types, {
    poolId: policy.poolId,
    trader: policy.trader,
    nonce: policy.nonce,
    expiry: policy.expiry,
    maxLoss: policy.maxLoss,
    maxFee: policy.maxFee,
    zeroForOne: policy.zeroForOne,
    amountSpecified: policy.amountSpecified,
    sqrtPriceLimitX96: policy.sqrtPriceLimitX96
}, signature);
console.log("Signer:   ", wallet.address);
console.log("Recovered:", recovered);
console.log("Digest:   ", digest);
console.log("Signature:", signature);
if (recovered.toLowerCase() !==
    wallet.address.toLowerCase()) {
    throw new Error("EIP-712 signer recovery failed");
}
console.log("EIP-712 SIGNATURE VERIFIED");
console.log("EIP-712 DIGEST:", digest);

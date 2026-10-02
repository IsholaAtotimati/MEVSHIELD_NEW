import { verifyTypedData } from "ethers";
const domain = {
    name: "MEVShield",
    version: "1",
    chainId: 31337,
    verifyingContract: "0x5615dEB798BB3E4dFa0139dFa1b3D433Cc23b72f"
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
const policy = {
    poolId: "0x7ea41243798f304c9efd5c2e0c82a273090146c4718014ecc8570eb373df2b78",
    trader: "0x0000000000000000000000000000000000001234",
    nonce: 1n,
    expiry: 3601n,
    maxLoss: 200000n,
    maxFee: 20000n,
    zeroForOne: true,
    amountSpecified: -100000000n,
    sqrtPriceLimitX96: 79228162514264337593543950336n
};
const signature = "0xd62929055afee3e1293fc8639b0c64cd1ed2bed826ee458876ef12f52f26f5342f68e0305a00dacf1b1d3151cc5f5fe2b0de2495afae7246d034d5b53b870df21c";
const recovered = verifyTypedData(domain, types, policy, signature);
const expected = "0xe05fcC23807536bEe418f142D19fa0d21BB0cfF7";
console.log("Recovered:", recovered);
console.log("Expected: ", expected);
if (recovered.toLowerCase() !== expected.toLowerCase()) {
    throw new Error("API signature verification FAILED");
}
console.log("API SIGNATURE VERIFIED");

import { calculateRisk } from "../risk/riskEngine.js";
export function generatePolicy(request) {
    const risk = calculateRisk({
        amountSpecified: request.amountSpecified,
        zeroForOne: request.zeroForOne
    });
    const policy = {
        poolId: request.poolId,
        trader: request.trader,
        nonce: request.nonce,
        expiry: request.expiry,
        maxLoss: risk.maxLoss,
        maxFee: risk.maxFee,
        zeroForOne: request.zeroForOne,
        amountSpecified: request.amountSpecified,
        sqrtPriceLimitX96: request.sqrtPriceLimitX96
    };
    return {
        policy,
        actualLoss: risk.actualLoss,
        actualFee: risk.actualFee,
        riskLevel: risk.riskLevel
    };
}

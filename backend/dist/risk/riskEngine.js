export function calculateRisk(input) {
    const absoluteAmount = input.amountSpecified < 0n
        ? -input.amountSpecified
        : input.amountSpecified;
    /*
     * MVP risk model.
     *
     * This is intentionally deterministic.
     * No AI and no randomness.
     *
     * The real production engine can later incorporate:
     * - price impact
     * - volatility
     * - liquidity depth
     * - expected slippage
     * - oracle data
     * - MEV exposure
     */
    const actualLoss = absoluteAmount / 1000n;
    const actualFee = absoluteAmount / 10000n;
    const maxLoss = actualLoss * 2n;
    const maxFee = actualFee * 2n;
    // Current MVP loss model is fixed at 0.1% of absolute trade size.
    // Risk thresholds are expressed as loss in basis points.
    const lossBps = absoluteAmount === 0n
        ? 0n
        : (actualLoss * 10000n) / absoluteAmount;
    let riskLevel;
    if (lossBps <= 10n) {
        riskLevel = "LOW";
    }
    else if (lossBps <= 50n) {
        riskLevel = "MEDIUM";
    }
    else {
        riskLevel = "HIGH";
    }
    return {
        actualLoss,
        actualFee,
        maxLoss,
        maxFee,
        riskLevel
    };
}

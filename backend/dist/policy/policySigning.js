import { assertConfiguredPoolId, } from "../config/runtimeConfig.js";
import { signPolicy } from "../signer/policySigner.js";
export async function signProtectedPolicy(wallet, policy, config, signer = signPolicy) {
    assertConfiguredPoolId(policy.poolId, config.protectedPool);
    return signer(wallet, policy, {
        chainId: config.chainId,
        verifyingContract: config.verifierAddress,
    });
}

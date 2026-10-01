// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {console2} from "forge-std/console2.sol";
import {PolicyVerifier} from "../src/PolicyVerifier.sol";

contract PolicyVerifierTest is Test {
    PolicyVerifier verifier;

    uint256 signerPrivateKey = 0xA11CE;
    address signer;

    uint256 attackerPrivateKey = 0xB0B;
    address attacker;

    PolicyVerifier.Policy policy;

    function setUp() public {
        verifier = new PolicyVerifier();

        signer = vm.addr(signerPrivateKey);
        attacker = vm.addr(attackerPrivateKey);

        verifier.setAuthorizedSigner(signer);

        policy = PolicyVerifier.Policy({
            poolId: keccak256("ETH/USDC"),
            trader: address(0x1234),
            nonce: 1,
            expiry: block.timestamp + 1 hours,
            maxLoss: 100,
            maxFee: 5,
            zeroForOne: true,
            amountSpecified: -100e6,
            sqrtPriceLimitX96: 79228162514264337593543950336
        });
    }

    function test_PrintEIP712CompatibilityValues() public {
        console2.log("Verifier:", address(verifier));
        console2.log("Chain ID:", block.chainid);
        console2.log("Expiry:", policy.expiry);
        console2.logBytes32(verifier.hashPolicy(policy));
    }

    function _signPolicy(PolicyVerifier.Policy memory p, uint256 privateKey)
        internal
        view
        returns (bytes memory signature)
    {
        bytes32 digest = verifier.hashPolicy(p);

        (uint8 v, bytes32 r, bytes32 s) = vm.sign(privateKey, digest);

        signature = abi.encodePacked(r, s, v);
    }

    function test_ValidSignature() public {
        bytes memory signature = _signPolicy(policy, signerPrivateKey);

        bool valid = verifier.verifyPolicy(policy, signature);

        assertTrue(valid);
    }

    function test_RevertWhenUnauthorizedSigner() public {
        bytes memory signature = _signPolicy(policy, attackerPrivateKey);

        vm.expectRevert(PolicyVerifier.UnauthorizedSigner.selector);

        verifier.verifyPolicy(policy, signature);
    }

    function test_RevertWhenPoolIdModified() public {
        bytes memory signature = _signPolicy(policy, signerPrivateKey);

        policy.poolId = keccak256("BTC/USDC");

        vm.expectRevert(PolicyVerifier.UnauthorizedSigner.selector);

        verifier.verifyPolicy(policy, signature);
    }

    function test_RevertWhenTraderModified() public {
        bytes memory signature = _signPolicy(policy, signerPrivateKey);

        policy.trader = address(0x5678);

        vm.expectRevert(PolicyVerifier.UnauthorizedSigner.selector);

        verifier.verifyPolicy(policy, signature);
    }

    function test_RevertWhenNonceModified() public {
        bytes memory signature = _signPolicy(policy, signerPrivateKey);

        policy.nonce = 2;

        vm.expectRevert(PolicyVerifier.UnauthorizedSigner.selector);

        verifier.verifyPolicy(policy, signature);
    }

    function test_RevertWhenExpiryModified() public {
        bytes memory signature = _signPolicy(policy, signerPrivateKey);

        policy.expiry += 1;

        vm.expectRevert(PolicyVerifier.UnauthorizedSigner.selector);

        verifier.verifyPolicy(policy, signature);
    }

    function test_RevertWhenMaxLossModified() public {
        bytes memory signature = _signPolicy(policy, signerPrivateKey);

        policy.maxLoss = 1000;

        vm.expectRevert(PolicyVerifier.UnauthorizedSigner.selector);

        verifier.verifyPolicy(policy, signature);
    }

    function test_RevertWhenMaxFeeModified() public {
        bytes memory signature = _signPolicy(policy, signerPrivateKey);

        policy.maxFee = 1000;

        vm.expectRevert(PolicyVerifier.UnauthorizedSigner.selector);

        verifier.verifyPolicy(policy, signature);
    }

    function test_HashChangesWhenPolicyChanges() public {
        bytes32 originalHash = verifier.hashPolicy(policy);

        policy.maxLoss = 999;

        bytes32 modifiedHash = verifier.hashPolicy(policy);

        assertTrue(originalHash != modifiedHash);
    }

    function test_RecoverSigner() public {
        bytes memory signature = _signPolicy(policy, signerPrivateKey);

        address recovered = verifier.recoverSigner(policy, signature);

        assertEq(recovered, signer);
    }

    function test_OwnerCanChangeAuthorizedSigner() public {
        address newSigner = vm.addr(0xCAFE);

        verifier.setAuthorizedSigner(newSigner);

        assertEq(verifier.authorizedSigner(), newSigner);
    }

    function test_RevertWhenNonOwnerChangesSigner() public {
        vm.prank(attacker);

        vm.expectRevert(PolicyVerifier.NotOwner.selector);

        verifier.setAuthorizedSigner(attacker);
    }

    function test_RevertWhenSignerIsZero() public {
        vm.expectRevert(PolicyVerifier.InvalidSigner.selector);

        verifier.setAuthorizedSigner(address(0));
    }

    function test_OldSignerBecomesUnauthorized() public {
        bytes memory signature = _signPolicy(policy, signerPrivateKey);

        address newSigner = vm.addr(0xCAFE);

        verifier.setAuthorizedSigner(newSigner);

        vm.expectRevert(PolicyVerifier.UnauthorizedSigner.selector);

        verifier.verifyPolicy(policy, signature);
    }

    function test_SignatureCannotBeUsedByDifferentVerifier() public {
        bytes memory signature = _signPolicy(policy, signerPrivateKey);

        PolicyVerifier secondVerifier = new PolicyVerifier();

        secondVerifier.setAuthorizedSigner(signer);

        vm.expectRevert(PolicyVerifier.UnauthorizedSigner.selector);

        secondVerifier.verifyPolicy(policy, signature);
    }

    function test_SignatureCannotBeUsedOnDifferentChain() public {
        bytes memory signature = _signPolicy(policy, signerPrivateKey);

        vm.chainId(999999);

        vm.expectRevert(PolicyVerifier.UnauthorizedSigner.selector);

        verifier.verifyPolicy(policy, signature);
    }
}

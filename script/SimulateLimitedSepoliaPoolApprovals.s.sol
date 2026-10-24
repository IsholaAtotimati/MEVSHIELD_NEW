// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script, console2} from "forge-std/Script.sol";

interface IERC20LimitedApproval {
    function balanceOf(address owner) external view returns (uint256);
    function allowance(address owner, address spender)
        external
        view
        returns (uint256);
    function approve(address spender, uint256 amount)
        external
        returns (bool);
}

contract SimulateLimitedSepoliaPoolApprovals is Script {
    uint256 internal constant SEPOLIA_CHAIN_ID = 11155111;

    address internal constant EXPECTED_OWNER =
        0x016B78a30CE176EF0B90c122e8677e13aAB2A815;

    address internal constant USDC =
        0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238;

    address internal constant WETH =
        0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14;

    address internal constant PERMIT2 =
        0x000000000022D473030F116dDEE9F6B43aC78BA3;

    uint256 internal constant USDC_AMOUNT = 250_000;
    uint256 internal constant WETH_AMOUNT = 150_000_000_000_000;

    function run() external {
        require(block.chainid == SEPOLIA_CHAIN_ID, "Wrong chain");
        require(USDC.code.length != 0, "USDC has no code");
        require(WETH.code.length != 0, "WETH has no code");
        require(PERMIT2.code.length != 0, "Permit2 has no code");

        uint256 privateKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address owner = vm.addr(privateKey);
        require(owner == EXPECTED_OWNER, "Unexpected approval owner");

        IERC20LimitedApproval usdc = IERC20LimitedApproval(USDC);
        IERC20LimitedApproval weth = IERC20LimitedApproval(WETH);

        require(
            usdc.balanceOf(owner) >= USDC_AMOUNT,
            "Insufficient USDC balance"
        );
        require(
            weth.balanceOf(owner) >= WETH_AMOUNT,
            "Insufficient WETH balance"
        );

        uint256 usdcAllowance = usdc.allowance(owner, PERMIT2);
        uint256 wethAllowance = weth.allowance(owner, PERMIT2);

        console2.log("Existing USDC allowance:", usdcAllowance);
        console2.log("Existing WETH allowance:", wethAllowance);
        console2.log("Only approvals below the configured ceilings will be updated.");

        console2.log("Chain ID:", block.chainid);
        console2.log("Approval owner:", owner);
        console2.log("USDC approval target (raw):", USDC_AMOUNT);
        console2.log("WETH approval target (raw):", WETH_AMOUNT);
        console2.log("No Permit2-to-PositionManager allowance is granted.");

        vm.startBroadcast(privateKey);

        if (usdcAllowance < USDC_AMOUNT) {
            require(usdc.approve(PERMIT2, USDC_AMOUNT), "USDC approval failed");
        }

        if (wethAllowance < WETH_AMOUNT) {
            require(weth.approve(PERMIT2, WETH_AMOUNT), "WETH approval failed");
        }

        vm.stopBroadcast();

        console2.log("Approval calls completed in simulation/broadcast mode.");
    }
}

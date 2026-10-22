// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script, console2} from "forge-std/Script.sol";

interface IERC20Permit2Setup {
    function balanceOf(address owner) external view returns (uint256);
    function allowance(address owner, address spender)
        external
        view
        returns (uint256);
}

interface IPermit2ApprovalSetup {
    function approve(
        address token,
        address spender,
        uint160 amount,
        uint48 expiration
    ) external;

    function allowance(address owner, address token, address spender)
        external
        view
        returns (uint160 amount, uint48 expiration, uint48 nonce);
}

interface IPositionManagerPermit2Setup {
    function permit2() external view returns (address);
}

contract ApproveSepoliaPermit2 is Script {
    uint256 private constant SEPOLIA_CHAIN_ID = 11155111;

    address private constant EXPECTED_OWNER =
        0x016B78a30CE176EF0B90c122e8677e13aAB2A815;

    address private constant USDC =
        0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238;

    address private constant WETH =
        0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14;

    address private constant PERMIT2 =
        0x000000000022D473030F116dDEE9F6B43aC78BA3;

    address private constant POSITION_MANAGER =
        0x429ba70129df741B2Ca2a85BC3A2a3328e5c09b4;

    bytes32 private constant POSITION_MANAGER_CODE_HASH =
        0xcffd746f78c2b50aafd19076bbe9c48f14446e5248fc5d76b9b4896610e51aab;

    bytes32 private constant PERMIT2_CODE_HASH =
        0x96d9f5c3f0fb0423426b7f970186235b7347027f4e5c19c40c412b7d97fc3751;

    uint160 private constant USDC_AMOUNT = 3_000_000;
    uint160 private constant WETH_AMOUNT = 1_000_000_000_000_000;

    function run() external {
        require(block.chainid == SEPOLIA_CHAIN_ID, "Wrong chain");
        require(USDC.code.length != 0, "USDC has no code");
        require(WETH.code.length != 0, "WETH has no code");
        require(PERMIT2.code.length != 0, "Permit2 has no code");
        require(
            PERMIT2.codehash == PERMIT2_CODE_HASH,
            "Permit2 code hash mismatch"
        );
        require(
            POSITION_MANAGER.code.length != 0,
            "PositionManager has no code"
        );
        require(
            POSITION_MANAGER.codehash == POSITION_MANAGER_CODE_HASH,
            "PositionManager code hash mismatch"
        );
        require(
            IPositionManagerPermit2Setup(POSITION_MANAGER).permit2()
                == PERMIT2,
            "PositionManager Permit2 mismatch"
        );

        uint256 deadline = vm.envUint("POOL_POSITION_DEADLINE");
        require(
            deadline > block.timestamp
                && deadline <= block.timestamp + 30 minutes,
            "Deadline must be within the next 30 minutes"
        );

        uint256 privateKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address owner = vm.addr(privateKey);
        require(owner == EXPECTED_OWNER, "Unexpected approval owner");

        IERC20Permit2Setup usdc = IERC20Permit2Setup(USDC);
        IERC20Permit2Setup weth = IERC20Permit2Setup(WETH);

        require(
            usdc.balanceOf(owner) >= USDC_AMOUNT,
            "Insufficient USDC balance"
        );
        require(
            weth.balanceOf(owner) >= WETH_AMOUNT,
            "Insufficient WETH balance"
        );

        require(
            usdc.allowance(owner, PERMIT2) >= USDC_AMOUNT,
            "USDC ERC20 approval to Permit2 is missing"
        );
        require(
            weth.allowance(owner, PERMIT2) >= WETH_AMOUNT,
            "WETH ERC20 approval to Permit2 is missing"
        );

        IPermit2ApprovalSetup permit2 =
            IPermit2ApprovalSetup(PERMIT2);

        (uint160 usdcCurrent, uint48 usdcExpiry,) =
            permit2.allowance(owner, USDC, POSITION_MANAGER);
        (uint160 wethCurrent, uint48 wethExpiry,) =
            permit2.allowance(owner, WETH, POSITION_MANAGER);

        bool approveUsdc =
            usdcCurrent < USDC_AMOUNT || usdcExpiry < deadline;
        bool approveWeth =
            wethCurrent < WETH_AMOUNT || wethExpiry < deadline;

        uint48 expiration = uint48(deadline);

        console2.log("Chain ID:", block.chainid);
        console2.log("Owner:", owner);
        console2.log("PositionManager:", POSITION_MANAGER);
        console2.log("USDC amount (raw):", uint256(USDC_AMOUNT));
        console2.log("WETH amount (raw):", uint256(WETH_AMOUNT));
        console2.log("Allowance expiry:", uint256(expiration));
        console2.log("USDC Permit2 approval needed:", approveUsdc);
        console2.log("WETH Permit2 approval needed:", approveWeth);
        console2.log("This script does not add liquidity.");

        vm.startBroadcast(privateKey);

        if (approveUsdc) {
            permit2.approve(
                USDC, POSITION_MANAGER, USDC_AMOUNT, expiration
            );
        }

        if (approveWeth) {
            permit2.approve(
                WETH, POSITION_MANAGER, WETH_AMOUNT, expiration
            );
        }

        vm.stopBroadcast();

        console2.log("Simulation completed; no broadcast requested.");
    }
}

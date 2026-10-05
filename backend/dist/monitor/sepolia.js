import { AbiCoder, Interface, JsonRpcProvider, getAddress, isAddress, keccak256, } from "ethers";
import { logEvent } from "../observability/logger.js";
import { clearPolicyRequest, requestIdForPolicy, } from "../observability/requestCorrelation.js";
const CHAIN_ID = 11155111;
const POLL_INTERVAL_MS = 12_000;
const registryInterface = new Interface([
    "event PolicyRegistered(bytes32 indexed policyId, bytes32 indexed poolId, address indexed trader, uint256 nonce, uint256 expiry, uint256 maxLoss, uint256 maxFee)",
]);
const hookInterface = new Interface([
    "event SwapPolicyEnforced(bytes32 indexed poolId, address indexed trader, uint256 nonce, uint256 maxLoss, uint256 maxFee)",
]);
const policyRegisteredTopic = registryInterface.getEvent("PolicyRegistered").topicHash;
const swapPolicyEnforcedTopic = hookInterface.getEvent("SwapPolicyEnforced").topicHash;
let monitorState;
function firstConfigured(...values) {
    return values.find((value) => value?.trim())?.trim();
}
export function startSepoliaMonitor() {
    if (monitorState) {
        return () => monitorState?.status ?? "disabled";
    }
    const rpcUrl = firstConfigured(process.env.SEPOLIA_RPC_URL, process.env.RPC_URL);
    const registryAddress = firstConfigured(process.env.POLICY_REGISTRY_ADDRESS, process.env.POLICY_REGISTRY);
    const hookAddress = firstConfigured(process.env.HOOK_ADDRESS, process.env.MEVSHIELD_HOOK_ADDRESS);
    const routerAddress = firstConfigured(process.env.ROUTER_ADDRESS, process.env.MEVSHIELD_ROUTER);
    const missing = [
        ["SEPOLIA_RPC_URL or RPC_URL", rpcUrl],
        ["POLICY_REGISTRY_ADDRESS or POLICY_REGISTRY", registryAddress],
        ["HOOK_ADDRESS or MEVSHIELD_HOOK_ADDRESS", hookAddress],
    ]
        .filter(([, value]) => !value)
        .map(([name]) => name);
    if (missing.length > 0) {
        logEvent("warn", "sepolia_monitor_disabled", { missing });
        monitorState = {
            status: "disabled",
            stop: () => undefined,
        };
        return () => monitorState?.status ?? "disabled";
    }
    if (!isAddress(registryAddress) || !isAddress(hookAddress)) {
        throw new Error("Sepolia monitor contract addresses are invalid");
    }
    const registry = getAddress(registryAddress);
    const hook = getAddress(hookAddress);
    const router = routerAddress && isAddress(routerAddress)
        ? getAddress(routerAddress)
        : undefined;
    const provider = new JsonRpcProvider(rpcUrl, CHAIN_ID, {
        staticNetwork: true,
    });
    let status = "starting";
    let lastScannedBlock;
    let hasConnected = false;
    let pollRunning = false;
    let stopped = false;
    const stop = () => {
        stopped = true;
        if (monitorState?.timer) {
            clearInterval(monitorState.timer);
        }
        void provider.destroy();
    };
    monitorState = { status, stop };
    const updateStatus = (next) => {
        status = next;
        if (monitorState) {
            monitorState.status = next;
        }
    };
    const processLog = async (log) => {
        const isPolicyRegistration = log.address.toLowerCase() === registry.toLowerCase() &&
            log.topics[0]?.toLowerCase() === policyRegisteredTopic.toLowerCase();
        const eventInterface = isPolicyRegistration
            ? registryInterface
            : hookInterface;
        const parsed = eventInterface.parseLog(log);
        if (!parsed) {
            logEvent("warn", "sepolia_event_decode_failed", {
                contract: log.address,
                blockNumber: log.blockNumber,
                transactionHash: log.transactionHash,
                logIndex: log.index,
            });
            return;
        }
        const args = parsed.args;
        const policyId = isPolicyRegistration
            ? String(args.policyId)
            : keccak256(AbiCoder.defaultAbiCoder().encode(["bytes32", "address", "uint256"], [args.poolId, args.trader, args.nonce]));
        const requestId = requestIdForPolicy(policyId);
        const eventFields = {
            ...(requestId ? { requestId } : {}),
            eventName: parsed.name,
            contract: getAddress(log.address),
            blockNumber: log.blockNumber,
            transactionHash: log.transactionHash,
            logIndex: log.index,
            policyId,
            poolId: String(args.poolId),
            trader: String(args.trader),
            nonce: String(args.nonce),
            ...(isPolicyRegistration
                ? {
                    expiry: String(args.expiry),
                    maxLoss: String(args.maxLoss),
                    maxFee: String(args.maxFee),
                }
                : {
                    maxLoss: String(args.maxLoss),
                    maxFee: String(args.maxFee),
                }),
        };
        logEvent("info", "sepolia_contract_event", eventFields);
        if (!requestId) {
            return;
        }
        try {
            const receipt = await provider.getTransactionReceipt(log.transactionHash);
            if (!receipt) {
                throw new Error("Transaction receipt is not available yet");
            }
            const gasUsed = receipt.gasUsed.toString();
            const statusCode = receipt.status;
            if (isPolicyRegistration) {
                logEvent("info", "policy_registration_confirmed", {
                    requestId,
                    txHash: log.transactionHash,
                    blockNumber: log.blockNumber,
                    gasUsed,
                    status: statusCode,
                    contract: registry,
                    nonce: String(args.nonce),
                });
            }
            else {
                logEvent("info", "swap_confirmed", {
                    requestId,
                    txHash: log.transactionHash,
                    blockNumber: log.blockNumber,
                    gasUsed,
                    status: statusCode,
                    router: receipt.to
                        ? getAddress(receipt.to)
                        : router,
                    hook: hook,
                    nonce: String(args.nonce),
                });
                clearPolicyRequest(policyId);
            }
        }
        catch (error) {
            logEvent("error", "sepolia_receipt_lookup_failed", {
                ...(requestId ? { requestId } : {}),
                txHash: log.transactionHash,
                errorName: error instanceof Error ? error.name : "UnknownError",
                errorMessage: error instanceof Error ? error.message : String(error),
            });
        }
    };
    const poll = async () => {
        if (pollRunning || stopped) {
            return;
        }
        pollRunning = true;
        try {
            const latestBlock = await provider.getBlockNumber();
            if (!hasConnected || status === "error") {
                const network = await provider.getNetwork();
                if (network.chainId !== BigInt(CHAIN_ID)) {
                    throw new Error(`Sepolia monitor connected to unexpected chain ${network.chainId}`);
                }
            }
            if (!hasConnected) {
                hasConnected = true;
                logEvent("info", "sepolia_monitor_connected", {
                    chainId: CHAIN_ID,
                    latestBlock,
                    registry,
                    hook,
                });
            }
            else if (status === "error") {
                logEvent("info", "sepolia_monitor_reconnected", {
                    chainId: CHAIN_ID,
                    latestBlock,
                });
            }
            updateStatus("connected");
            if (latestBlock !== lastScannedBlock) {
                logEvent("info", "sepolia_new_block", {
                    blockNumber: latestBlock,
                });
            }
            const fromBlock = lastScannedBlock === undefined
                ? latestBlock
                : lastScannedBlock + 1;
            if (fromBlock <= latestBlock) {
                const logs = await provider.getLogs({
                    address: [registry, hook],
                    topics: [[policyRegisteredTopic, swapPolicyEnforcedTopic]],
                    fromBlock,
                    toBlock: latestBlock,
                });
                for (const log of logs) {
                    await processLog(log);
                }
                lastScannedBlock = latestBlock;
            }
        }
        catch (error) {
            const wasConnected = status === "connected";
            updateStatus("error");
            logEvent("error", "sepolia_monitor_error", {
                ...(wasConnected ? { recoveredConnectionLost: true } : {}),
                errorName: error instanceof Error ? error.name : "UnknownError",
                errorMessage: error instanceof Error ? error.message : String(error),
            });
        }
        finally {
            pollRunning = false;
        }
    };
    void poll();
    monitorState.timer = setInterval(() => void poll(), POLL_INTERVAL_MS);
    monitorState.timer.unref();
    return () => status;
}

// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

interface IPolymerProver {
    function validateEvent(
        uint256 logIndex,
        bytes calldata proof
    )
        external
        view
        returns (
            string memory chainId,
            address emittingContract,
            bytes[] memory topics,
            bytes memory data
        );
}

/**
 * @title SimpleBridgeProtocol
 * @dev A simpler, more efficient cross-chain bridge protocol
 */
abstract contract SimpleBridgeProtocol {
    IPolymerProver public immutable polymerProver;

    enum BridgeState {
        NONE, // Initial state
        PENDING, // Action initiated on source chain
        COMPLETED // Action completed on destination chain
    }

    struct BridgeAction {
        address sourceChain;
        address destinationChain;
        address initiator;
        bytes payload;
        BridgeState state;
        uint256 timestamp;
        bytes32 proofHash;
    }

    // Mapping from action ID to BridgeAction details
    mapping(bytes32 => BridgeAction) public actions;
    // Prevent replay attacks
    mapping(bytes32 => bool) private usedProofHashes;

    event ActionInitiated(
        bytes32 indexed actionId,
        address indexed initiator,
        bytes payload
    );

    event ActionValidated(
        bytes32 indexed actionId,
        address indexed initiator,
        bytes32 proofHash
    );

    event ActionCompleted(bytes32 indexed actionId, bool success);

    constructor(address _polymerProver) {
        polymerProver = IPolymerProver(_polymerProver);
    }

    /**
     * @dev Generates a unique action ID based on chain and transaction details
     * @param payload The payload to be included in the action ID generation
     */
    function generateActionId(
        bytes memory payload
    ) internal view returns (bytes32) {
        return
            keccak256(
                abi.encodePacked(
                    block.chainid,
                    msg.sender,
                    payload,
                    block.timestamp
                )
            );
    }

    /**
     * @dev Initiates an action on the source chain
     * @param payload The payload to be sent to the destination chain
     */
    function initiateAction(bytes memory payload) internal returns (bytes32) {
        bytes32 actionId = generateActionId(payload);
        emit ActionInitiated(actionId, msg.sender, payload);
        return actionId;
    }

    // Step 1: Validate the proof and store the data
    function validateProof(uint256 logIndex, bytes calldata proof) external {
        // Step 1: Validate event
        (
            string memory sourceChainId,
            address sourceContract,
            bytes[] memory topics,
            bytes memory eventData
        ) = polymerProver.validateEvent(logIndex, proof);

        // Validate topics array (need at least 3: event signature, actionId, initiator)
        require(topics.length >= 3, "Invalid topics length");

        // Step 2: Create proof hash
        bytes32 proofHash = keccak256(
            abi.encodePacked(sourceChainId, sourceContract, proof)
        );
        require(!usedProofHashes[proofHash], "Proof already used");

        // Step 3: Extract data from topics
        // topics[0] is event signature
        bytes32 actionId = bytes32(topics[1]); // actionId from topics
        address initiator = address(uint160(uint256(bytes32(topics[2])))); // initiator from topics

        // Get payload from event data
        bytes memory payload = abi.decode(eventData, (bytes));

        // Store the validated data
        actions[actionId] = BridgeAction({
            sourceChain: sourceContract,
            destinationChain: address(this),
            initiator: initiator,
            payload: payload,
            state: BridgeState.PENDING,
            timestamp: block.timestamp,
            proofHash: proofHash
        });

        usedProofHashes[proofHash] = true;
        emit ActionValidated(actionId, initiator, proofHash);
    }

    // Step 2: Execute the validated action
    function executeValidatedAction(bytes32 actionId) external {
        BridgeAction storage action = actions[actionId];
        require(action.state == BridgeState.PENDING, "Invalid action state");
        require(action.proofHash != bytes32(0), "Action not validated");
        require(action.payload.length > 0, "Empty payload");

        bool success = _executeAction(actionId, action.payload);

        if (success) {
            action.state = BridgeState.COMPLETED;
        } else {
            delete actions[actionId];
        }

        emit ActionCompleted(actionId, success);
    }

    // Hook functions to be implemented by inheriting contracts
    function _executeAction(
        bytes32 actionId,
        bytes memory payload
    ) internal virtual returns (bool);
}

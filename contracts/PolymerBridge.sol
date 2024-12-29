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
 * @title PolymerBridge
 * @dev A protocol for bridging between chains using Polymer Protocol's Prover, allowing for method calls to be relayed between chains with the relayer
 */
abstract contract PolymerBridge {
    IPolymerProver public immutable polymerProver;

    enum BridgeState {
        NONE, // Initial state
        PENDING, // Action initiated on source chain
        COMPLETED, // Action completed on destination chain
        CHAINING // Action completed but waiting for next chain
    }

    struct BridgeAction {
        address sourceChain;
        address destinationChain;
        address initiator;
        bytes payload;
        BridgeState state;
        uint256 timestamp;
        bytes32 proofHash;
        bytes4 function_; // Function selector to call
        bytes4 nextFunction; // Function selector for the next action
        bytes nextPayload; // Payload for the next chain action
    }

    // Mapping from action ID to BridgeAction details
    mapping(bytes32 => BridgeAction) public actions;
    // Prevent replay attacks
    mapping(bytes32 => bool) private usedProofHashes;
    // Authorized initiators for chaining
    mapping(address => bool) public authorizedInitiators;
    // Registered function selectors
    mapping(bytes4 => bool) public registeredFunctions;

    event ActionInitiated(
        bytes32 indexed actionId,
        address indexed initiator,
        bytes4 indexed function_,
        bytes eventData
    );

    event ActionValidated(
        bytes32 indexed actionId,
        address indexed initiator,
        bytes32 proofHash
    );

    event ActionCompleted(bytes32 indexed actionId, bool success);

    event ActionChained(
        bytes32 indexed previousActionId,
        bytes32 indexed nextActionId,
        address indexed initiator,
        bytes4 nextFunction
    );

    event FunctionRegistered(bytes4 indexed selector);

    modifier onlyAuthorized() {
        require(authorizedInitiators[msg.sender], "Not authorized");
        _;
    }

    constructor(address _polymerProver) {
        polymerProver = IPolymerProver(_polymerProver);
        authorizedInitiators[msg.sender] = true; // Contract deployer is authorized
    }

    /**
     * @dev Register a function that can be called cross-chain
     * @param name The function name (e.g., "myFunction")
     */
    function registerFunction(bytes4 name) internal {
        registeredFunctions[name] = true;
        emit FunctionRegistered(name);
    }

    /**
     * @dev Generate a unique action ID from payload and context
     */
    function generateActionId(
        bytes memory payload
    ) internal view returns (bytes32) {
        return
            keccak256(
                abi.encodePacked(
                    block.chainid, // Source chain ID
                    address(this), // Contract address
                    msg.sender, // Initiator
                    block.timestamp, // Timestamp
                    payload // Original payload
                )
            );
    }

    /**
     * @dev Bridge a function call to the destination chain
     * @param function_ The function selector to call on destination
     * @param payload The payload for the function
     */
    function bridge(
        bytes4 function_,
        bytes memory payload
    ) internal returns (bytes32) {
        require(registeredFunctions[function_], "Function not registered");

        bytes32 actionId = generateActionId(payload);

        // Create and set up the action
        actions[actionId] = BridgeAction({
            sourceChain: msg.sender,
            destinationChain: address(this),
            initiator: msg.sender,
            payload: payload,
            state: BridgeState.PENDING,
            timestamp: block.timestamp,
            proofHash: bytes32(0),
            function_: function_,
            nextFunction: bytes4(0),
            nextPayload: ""
        });

        // Function is already in topics, just use payload as event data
        emit ActionInitiated(actionId, msg.sender, function_, payload);
        return actionId;
    }

    /**
     * @dev Validate the proof and store the data
     */
    function validateProof(uint256 logIndex, bytes calldata proof) external {
        // Step 1: Validate event
        (
            string memory sourceChainId,
            address sourceContract,
            bytes[] memory topics,
            bytes memory eventData
        ) = polymerProver.validateEvent(logIndex, proof);
        require(topics.length == 4, "Invalid topics length");

        // Step 2: Create proof hash
        bytes32 proofHash = keccak256(
            abi.encodePacked(sourceChainId, sourceContract, proof)
        );
        require(!usedProofHashes[proofHash], "Proof already used");

        // Step 3: Extract data from topics
        // topics[0] is event signature
        bytes32 actionId = bytes32(topics[1]); // actionId from topics
        address initiator = address(uint160(uint256(bytes32(topics[2])))); // initiator from topics
        bytes4 function_ = bytes4(bytes32(topics[3])); // function from topics

        // Get payload from event data - it's ABI encoded as bytes
        bytes memory payload = abi.decode(eventData, (bytes));

        // Store the validated data
        BridgeAction storage action = actions[actionId];
        action.sourceChain = sourceContract;
        action.destinationChain = address(this);
        action.initiator = initiator;
        action.payload = payload;
        action.state = BridgeState.PENDING;
        action.timestamp = block.timestamp;
        action.proofHash = proofHash;
        action.function_ = function_;

        usedProofHashes[proofHash] = true;
        emit ActionValidated(actionId, initiator, proofHash);
    }

    /**
     * @dev Execute the validated action
     */
    function executeValidatedAction(bytes32 actionId) external {
        BridgeAction storage action = actions[actionId];
        require(action.state == BridgeState.PENDING, "Invalid action state");
        require(action.proofHash != bytes32(0), "Action not validated");
        require(action.payload.length > 0, "Empty payload");

        // Execute the action with its function selector
        bool success = _executeFunction(action.function_, action.payload);
        require(success, "Action execution failed");

        // Check if there's a next action to chain
        if (action.nextFunction != bytes4(0)) {
            // Set current action to CHAINING
            action.state = BridgeState.CHAINING;

            // Generate new action ID for the next chain
            bytes32 nextActionId = generateActionId(action.nextPayload);

            // Create the next action
            actions[nextActionId] = BridgeAction({
                sourceChain: msg.sender,
                destinationChain: address(this),
                initiator: msg.sender,
                payload: action.nextPayload,
                state: BridgeState.PENDING,
                timestamp: block.timestamp,
                proofHash: bytes32(0),
                function_: action.nextFunction,
                nextFunction: bytes4(0),
                nextPayload: ""
            });

            // Emit events for the next action
            emit ActionChained(
                actionId,
                nextActionId,
                msg.sender,
                action.nextFunction
            );
            emit ActionInitiated(
                nextActionId,
                msg.sender,
                action.nextFunction,
                action.nextPayload
            );
        } else {
            action.state = BridgeState.COMPLETED;
        }

        emit ActionCompleted(actionId, success);
    }

    /**
     * @dev Execute function by selector - to be implemented by child contracts
     */
    function _executeFunction(
        bytes4 selector,
        bytes memory payload
    ) internal virtual returns (bool);
}

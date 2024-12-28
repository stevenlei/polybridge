// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "./SimpleBridgeProtocol.sol";

/**
 * @title ExampleContract
 * @dev A simple example that syncs a string value across chains
 */
contract ExampleContract is SimpleBridgeProtocol {
    // Store string values with their action IDs
    mapping(bytes32 => string) public strings;

    // Events for tracking string updates
    event StringUpdateStarted(
        bytes32 indexed actionId,
        string oldValue,
        string newValue
    );

    event StringUpdateCompleted(bytes32 indexed actionId, string value);

    constructor(address _polymerProver) SimpleBridgeProtocol(_polymerProver) {}

    /**
     * @dev Update string value and sync it to another chain
     * @param newValue The new string value to set
     */
    function updateString(string calldata newValue) external returns (bytes32) {
        // Prepare the payload (just the string value in this case)
        bytes memory payload = abi.encode(newValue);

        // Initiate the action and get the action ID
        bytes32 actionId = initiateAction(payload);

        // Store the string on the source chain
        strings[actionId] = newValue;

        emit StringUpdateStarted(actionId, strings[actionId], newValue);

        return actionId;
    }

    /**
     * @dev Hook called when executing the action (on destination chain)
     * Updates the string value on the destination chain
     */
    function _executeAction(
        bytes32 actionId,
        bytes memory payload
    ) internal override returns (bool) {
        require(payload.length > 0, "Empty payload");

        string memory newValue = abi.decode(payload, (string));

        // Store the string on the destination chain
        strings[actionId] = newValue;
        emit StringUpdateCompleted(actionId, newValue);

        return true;
    }

    /**
     * @dev Helper function to decode payload in a way that can be caught if it fails
     */
    function decodePayload(
        bytes memory payload
    ) external pure returns (string memory) {
        return abi.decode(payload, (string));
    }

    /**
     * @dev Get the string value for a specific action
     */
    function getString(
        bytes32 actionId
    )
        external
        view
        returns (string memory value, BridgeState state, uint256 timestamp)
    {
        BridgeAction memory action = actions[actionId];
        return (strings[actionId], action.state, action.timestamp);
    }
}

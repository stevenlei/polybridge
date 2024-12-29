// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "./PolyBridge.sol";

contract ExampleContract is PolyBridge {
    // Just one number to update
    uint256 public number;

    // Function selectors
    bytes4 public constant UPDATE_NUMBER_STEP_2 =
        bytes4(keccak256("updateNumberStep2_calledByRelayerOnChainB(uint256)"));
    bytes4 public constant UPDATE_NUMBER_STEP_3 =
        bytes4(keccak256("updateNumberStep3_calledByRelayerOnChainA(uint256)"));

    event NumberUpdated(uint256 oldValue, uint256 newValue, string step);

    constructor(address _polymerProver) PolyBridge(_polymerProver) {
        // Register functions that can be called cross-chain
        registerFunction(UPDATE_NUMBER_STEP_2);
        registerFunction(UPDATE_NUMBER_STEP_3);
    }

    /**
     * @dev Step 1: Update number on chain A and bridge to chain B
     */
    function updateNumberStep1_calledByClientOnChainA(
        uint256 initialValue
    ) external returns (bytes32) {
        uint256 oldValue = number;
        number = initialValue;
        emit NumberUpdated(oldValue, initialValue, "step1");

        // Bridge to chain B, calling updateNumber2
        return bridge(UPDATE_NUMBER_STEP_2, abi.encode(initialValue));
    }

    /**
     * @dev Step 2: Called on chain B, updates number and bridges back to chain A
     */
    function updateNumberStep2_calledByRelayerOnChainB(
        uint256 value
    ) public returns (bool) {
        uint256 oldValue = number;
        number = value + 1;
        emit NumberUpdated(oldValue, number, "step2");

        // Bridge back to chain A, calling updateNumber3
        bridge(UPDATE_NUMBER_STEP_3, abi.encode(number));
        return true;
    }

    /**
     * @dev Step 3: Final update on chain A
     */
    function updateNumberStep3_calledByRelayerOnChainA(
        uint256 value
    ) public returns (bool) {
        uint256 oldValue = number;
        number = value + 1;
        emit NumberUpdated(oldValue, number, "step3");
        return true;
    }

    /**
     * @dev Execute bridged function calls
     */
    function _executeFunction(
        bytes4 selector,
        bytes memory payload
    ) internal override returns (bool) {
        if (selector == UPDATE_NUMBER_STEP_2) {
            uint256 value = abi.decode(payload, (uint256));
            return updateNumberStep2_calledByRelayerOnChainB(value);
        } else if (selector == UPDATE_NUMBER_STEP_3) {
            uint256 value = abi.decode(payload, (uint256));
            return updateNumberStep3_calledByRelayerOnChainA(value);
        }
        revert("Unknown function selector");
    }
}

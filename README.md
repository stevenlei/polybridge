# Polybridge

Polybridge is a sophisticated cross-chain messaging protocol built on top of [Polymer](https://polymerlabs.org), enabling seamless action chaining and bidirectional message passing between different blockchains.

## Features

- 🔄 **Bidirectional Messaging**: Support for back-and-forth communication between chains
- 🔗 **Action Chaining**: Chain multiple cross-chain actions in sequence
- 🛡️ **Secure Message Passing**: Utilizes Polymer's Prover API
- 🎯 **Action Tracking**: Track the state of actions across multiple chains
- 🔍 **Detailed Event Logging**: Clear visibility into cross-chain operations

## Examples

### 1. Cross-Chain Counter

A simple example demonstrating number increment across chains:

1. Client initiates on Chain A (value = 1)
2. Relayer bridges to Chain B (value = 2)
3. Relayer bridges back to Chain A (value = 3)

### 2. Cross-Chain NFT Bridge

A more complex example showing NFT bridging between chains:

1. Client mints NFT on Chain A
2. Bridge to Chain B:
   - Client initiates the bridge and locks NFT on Chain A
   - Relayer mints and locks NFT on Chain B
3. Complete Bridge:
   - Relayer burns NFT on Chain A
   - Relayer unlocks NFT on Chain B

## Getting Started

### Prerequisites

- Node.js v18+
- `npm` or `yarn`
- A wallet with some testnet ETH on the following testnets:
  - Optimism Sepolia
  - Base Sepolia
- [Polymer API Key](https://docs.polymerlabs.org/docs/build/contact) for requesting the cross-chain proof

### Installation

1. Clone the repository:

   ```bash
   git clone https://github.com/stevenlei/polybridge.git
   cd polybridge
   ```

2. Install dependencies:

   ```bash
   npm install
   ```

3. Set up environment variables:

   ```bash
   cp .env.example .env
   ```

4. Edit `.env` with your configuration:

   ```
   PRIVATE_KEY=
   OPTIMISM_SEPOLIA_RPC=
   BASE_SEPOLIA_RPC=
   POLYMER_API_KEY=
   ```

   `OPTIMISM_SEPOLIA_CONTRACT_ADDRESS` and `BASE_SEPOLIA_CONTRACT_ADDRESS` will be set automatically after contract deployment, please note that both examples use the same contract address env variables for simplicity.

### Running Tests

**Deploy Contracts**

```bash
# For Counter Example
npm run deploy:counter:optimism
npm run deploy:counter:base

# For NFT Example
npm run deploy:nft:optimism
npm run deploy:nft:base
```

**Start the relayer**

```bash
npm run relayer
```

**Run the test**

```bash
# For Counter Example
npm run test:counter

# For NFT Example
npm run test:nft
```

## Architecture

### Core Components

1. **PolyBridge Contract**

   Base contract for cross-chain messaging. To use this contract:

   1. Inherit from `PolyBridge`:

      ```solidity
      contract YourContract is PolyBridge {
         constructor(address _polymerProver) PolyBridge(_polymerProver) {}
      }
      ```

   2. Register functions that can be called cross-chain:

      ```solidity
      // In your constructor
      registerFunction(bytes4(keccak256("yourFunction(uint256)")));
      ```

   3. Call `bridge()` to initiate cross-chain actions which will be validated and executed by the relayer:

      ```solidity
      // In your function
      function startCrossChainAction() external returns (bytes32) {
         // The target function selector
         bytes4 targetFunction = bytes4(keccak256("targetFunction(uint256)"));

         // The value to pass to the target function
         uint256 value = 42;

         return bridge(targetFunction, abi.encode(value));
      }
      ```

   4. Implement `_executeFunction()` to handle incoming calls from the relayer:

      ```solidity
      function _executeFunction(
          bytes4 selector,
          bytes memory payload
      ) internal override returns (bool) {
          if (selector == bytes4(keccak256("targetFunction(uint256)"))) {
              // Decode the payload and get the value
              uint256 value = abi.decode(payload, (uint256));

           // Call the target function
           return targetFunction(value);
         }
         revert("Unknown function selector");
      }
      ```

2. **Relayer**

   - Monitors chains for events
   - Requests proofs from Polymer API
   - Submit proofs to destination chain
   - Handles bidirectional message passing

## Example Contracts

### 1. Cross-Chain Counter

Located in `contracts/example/CrossChainCounter.sol`, demonstrates a complete counter bridge flow:

- `updateNumberStep1_calledByClientOnChainA`: Client initiates on Chain A
- `updateNumberStep2_calledByRelayerOnChainB`: Relayer executes on Chain B
- `updateNumberStep3_calledByRelayerOnChainA`: Relayer completes on Chain A

Each step:

1.  Updates a number value
2.  Emits an event for tracking
3.  Bridges to the next chain if needed

_The function names are intentionally verbose for better readability._

### 2. Cross-Chain NFT Bridge

Located in `contracts/example/CrossChainNFT.sol`, demonstrates a complete NFT bridge flow:

- `mintOnChainA`: Client mints NFT on Chain A
- `bridgeToChainB`: Client mints NFT on Chain A
- `mintOnChainB`: Relayer mints and locks NFT on Chain B
- `burnOnChainA`: Relayer burns NFT on Chain A
- `unlockOnChainB`: Relayer unlocks NFT on Chain B

Each step:

1.  Emits an event for tracking
2.  Bridges to the next chain if needed

## Disclaimer

This is a proof of concept and is not intended for production use. It may contain bugs, vulnerabilities, or other issues that make it unsuitable for use in a production environment. I am not responsible for any issues that may arise from using this project on mainnet.

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

require("dotenv").config();
const ethers = require("ethers");
const axios = require("axios");
const chalk = require("chalk");

const POLYMER_API_URL = "https://proof.sepolia.polymer.zone";

// Chain configurations
const CHAIN_A = process.env.CHAIN_A;
const CHAIN_B = process.env.CHAIN_B;

if (!CHAIN_A || !CHAIN_B) {
  console.error("Chains not set. Please set CHAIN_A and CHAIN_B in .env");
  process.exit(1);
}

const CHAINS = require("../config/chains");

class ChainConnection {
  constructor(config, wallet) {
    this.config = config;
    this.provider = new ethers.JsonRpcProvider(config.rpcUrl);
    this.wallet = wallet.connect(this.provider);
    this.contract = new ethers.Contract(
      config.contractAddress,
      require("../artifacts/contracts/PolymerBridge.sol/PolymerBridge.json").abi, // we should always use the parent contract, as this relayer handles events from that contract
      this.wallet
    );
  }
}

class PolymerBridgeRelayer {
  constructor(polymerApiUrl, polymerApiKey) {
    this.polymerApiUrl = polymerApiUrl;
    this.polymerApiKey = polymerApiKey;
    this.processedEvents = new Set();
  }

  async start(sourceChain, destChain) {
    console.log(
      chalk.blue(
        `\nStarting bidirectional relayer between ${chalk.bold(
          sourceChain.config.name
        )} and ${chalk.bold(destChain.config.name)}`
      )
    );

    // Monitor both chains for ActionInitiated events
    this.monitorChain(sourceChain, destChain);
    this.monitorChain(destChain, sourceChain);
  }

  monitorChain(sourceChain, destChain) {
    console.log(
      chalk.yellow(`Listening to ${chalk.bold(sourceChain.config.name)}...`)
    );

    // Listen for ActionInitiated events
    sourceChain.contract.on(
      "ActionInitiated",
      async (actionId, initiator, function_, eventData, event) => {
        const eventId = `${event.log.blockHash}-${event.log.transactionHash}-${event.log.index}`;
        if (this.processedEvents.has(eventId)) return; // Skip if we've already processed this event

        console.log(
          chalk.blue(
            `\n🔄 Action initiated on ${chalk.bold(sourceChain.config.name)}:`
          )
        );
        console.log(chalk.cyan(`Action ID: ${chalk.bold(actionId)}`));
        console.log(chalk.cyan(`Initiator: ${chalk.bold(initiator)}`));
        console.log(chalk.cyan(`Function: ${chalk.bold(function_)}`));
        console.log(chalk.cyan(`Event Data: ${chalk.bold(eventData)}`));

        await this.relayAction(sourceChain, destChain, event);
        this.processedEvents.add(eventId);
      }
    );
  }

  async relayAction(sourceChain, destChain, event) {
    try {
      const receipt = await event.log.getTransactionReceipt();

      // Get the position of the event in the block, we need this to request the proof
      const positionInBlock = receipt.index;

      // Find the index of ActionInitiated event in the logs, we need this to validate the proof
      const actionInitiatedIndex = receipt.logs.findIndex(
        (log) =>
          log.topics[0] === event.log.topics[0] &&
          log.logIndex === event.log.logIndex
      );

      console.log(chalk.yellow(`\n>  Requesting proof from Polymer API...`));
      console.log(
        chalk.cyan(`Block Number: ${chalk.bold(event.log.blockNumber)}`)
      );
      console.log(
        chalk.cyan(`Position in Block: ${chalk.bold(positionInBlock)}`)
      );
      console.log(
        chalk.cyan(`Source Chain ID: ${chalk.bold(sourceChain.config.chainId)}`)
      );
      console.log(
        chalk.cyan(`Dest Chain ID: ${chalk.bold(destChain.config.chainId)}`)
      );
      console.log(
        chalk.cyan(
          `Action Initiated Index: ${chalk.bold(actionInitiatedIndex)}`
        )
      );

      // Request proof generation
      const proofRequest = await axios.post(
        this.polymerApiUrl,
        {
          jsonrpc: "2.0",
          id: 1,
          method: "receipt_requestProof",
          params: [
            sourceChain.config.chainId,
            parseInt(destChain.config.chainId),
            event.log.blockNumber,
            positionInBlock,
          ],
        },
        {
          headers: {
            Authorization: `Bearer ${this.polymerApiKey}`,
          },
        }
      );

      if (proofRequest.status !== 200) {
        throw new Error(
          `Failed to get proof from Polymer API. Status code: ${proofRequest.status}`
        );
      }

      const jobId = proofRequest.data.result;
      console.log(
        chalk.green(`✅ Proof requested. Job ID: ${chalk.bold(jobId)}`)
      );

      // Wait for the proof to be generated
      console.log(chalk.yellow(`>  Waiting for proof to be generated...`));

      let proofResponse;
      let attempts = 0;
      const maxAttempts = 10;
      const initialDelay = 10000;
      const subsequentDelay = 5000;

      while (!proofResponse?.data?.result?.proof) {
        if (attempts >= maxAttempts) {
          throw new Error("Failed to get proof after multiple attempts");
        }

        await new Promise((resolve) =>
          setTimeout(resolve, attempts === 0 ? initialDelay : subsequentDelay)
        );

        proofResponse = await axios.post(
          this.polymerApiUrl,
          {
            jsonrpc: "2.0",
            id: 1,
            method: "receipt_queryProof",
            params: [jobId],
          },
          {
            headers: {
              Authorization: `Bearer ${this.polymerApiKey}`,
            },
          }
        );

        console.log(`>  Proof status: ${proofResponse.data.result.status}...`);
        attempts++;
      }

      const proof = proofResponse.data.result.proof;
      console.log(
        chalk.green(
          `✅ Proof received. Length: ${chalk.bold(proof.length)} bytes`
        )
      );

      // Convert proof to bytes
      const proofBytes = `0x${Buffer.from(proof, "base64").toString("hex")}`;

      // Validate and execute
      console.log(chalk.yellow("\n>  Validating proof..."));
      try {
        const tx = await destChain.contract.validateProof(
          actionInitiatedIndex,
          proofBytes
        );
        const receipt = await tx.wait();
        console.log(chalk.green("✅ Proof validated"));

        // Get the validated action ID from the receipt
        const validatedEvent = receipt.logs
          .map((log) => {
            try {
              return destChain.contract.interface.parseLog(log);
            } catch (e) {
              return null;
            }
          })
          .find((event) => event && event.name === "ActionValidated");

        if (!validatedEvent) {
          throw new Error("Could not find ActionValidated event");
        }

        const validatedActionId = validatedEvent.args[0];
        console.log(chalk.yellow("\n>  Executing action..."));

        const executeTx = await destChain.contract.executeValidatedAction(
          validatedActionId
        );
        await executeTx.wait();
        console.log(chalk.green("✅ Action executed"));
      } catch (error) {
        console.error(chalk.red("Error relaying action:"), error.message);
        if (error.error) {
          console.error(chalk.red("Error details:"), error.error);
        }
        return;
      }

      // Check if there's a next action to chain
      const chainedEvent = receipt.logs
        .map((log) => {
          try {
            return destChain.contract.interface.parseLog(log);
          } catch (e) {
            return null;
          }
        })
        .find((event) => event && event.name === "ActionChained");

      if (chainedEvent) {
        const [previousActionId, nextActionId, initiator, nextFunction] =
          chainedEvent.args;
        console.log(chalk.yellow("\n>  Action chained, calling next..."));
        console.log(
          chalk.cyan(`Previous Action ID: ${chalk.bold(previousActionId)}`)
        );
        console.log(chalk.cyan(`Next Action ID: ${chalk.bold(nextActionId)}`));
        console.log(chalk.cyan(`Next Function: ${chalk.bold(nextFunction)}`));
      }
    } catch (error) {
      console.error(chalk.red("Error relaying action:"), error.message);
    }
  }
}

async function main() {
  const privateKey = process.env.PRIVATE_KEY;
  if (!privateKey) {
    console.error("Private key not found in environment variables");
    process.exit(1);
  }

  const wallet = new ethers.Wallet(privateKey);
  const chainAConfig = CHAINS[CHAIN_A];
  const chainBConfig = CHAINS[CHAIN_B];

  if (!chainAConfig || !chainBConfig) {
    console.error("Invalid chain configuration");
    process.exit(1);
  }

  const chainA = new ChainConnection(chainAConfig, wallet);
  const chainB = new ChainConnection(chainBConfig, wallet);

  const relayer = new PolymerBridgeRelayer(
    POLYMER_API_URL,
    process.env.POLYMER_API_KEY
  );
  await relayer.start(chainA, chainB);
}

main().catch((error) => {
  console.error(chalk.red("Error in main:"), error);
  process.exit(1);
});

process.on("unhandledRejection", (error) => {
  console.error(chalk.red("Unhandled promise rejection:"), error);
});

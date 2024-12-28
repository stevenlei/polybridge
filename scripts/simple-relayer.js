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

// Contract ABI
const CONTRACT_ABI =
  require("../artifacts/contracts/SimpleBridgeProtocol.sol/SimpleBridgeProtocol.json").abi;

class ChainConnection {
  constructor(config, wallet) {
    this.config = config;
    this.provider = new ethers.JsonRpcProvider(config.rpcUrl);
    this.contract = new ethers.Contract(
      config.contractAddress,
      CONTRACT_ABI,
      wallet.connect(this.provider)
    );
  }
}

class SimpleRelayer {
  constructor(chainAConfig, chainBConfig, wallet) {
    this.chainA = new ChainConnection(chainAConfig, wallet);
    this.chainB = new ChainConnection(chainBConfig, wallet);
    this.processedEvents = new Set();
  }

  async start() {
    console.log(
      chalk.blue(
        `Starting bidirectional relayer between:\nChain A: ${chalk.bold(
          this.chainA.config.name
        )}\nChain B: ${chalk.bold(this.chainB.config.name)}`
      )
    );

    // Monitor Chain A for actions to relay to Chain B
    this.monitorChain(this.chainA, this.chainB);

    // Monitor Chain B for actions to relay to Chain A
    this.monitorChain(this.chainB, this.chainA);
  }

  monitorChain(sourceChain, destChain) {
    // Listen for ActionInitiated events
    sourceChain.contract.on(
      "ActionInitiated",
      async (actionId, initiator, payload, event) => {
        const eventId = `${event.log.blockHash}-${event.log.transactionHash}-${event.log.index}`;
        if (this.processedEvents.has(eventId)) return;

        console.log(
          chalk.blue(
            `\n🔄 Action initiated on ${chalk.bold(sourceChain.config.name)}:`
          )
        );
        console.log(chalk.cyan(`Action ID: ${chalk.bold(actionId)}`));
        console.log(chalk.cyan(`Initiator: ${chalk.bold(initiator)}`));

        await this.relayAction(sourceChain, destChain, event);
        this.processedEvents.add(eventId);
      }
    );

    // Listen for ActionCompleted events
    sourceChain.contract.on(
      "ActionCompleted",
      async (actionId, success, event) => {
        const eventId = `${event.log.blockHash}-${event.log.transactionHash}-${event.log.index}`;
        if (this.processedEvents.has(eventId)) return;

        console.log(
          success
            ? chalk.green(
                `\n✅ Action completed on ${chalk.bold(
                  sourceChain.config.name
                )}:`
              )
            : chalk.red(
                `\n❌ Action failed on ${chalk.bold(sourceChain.config.name)}:`
              )
        );
        console.log(chalk.cyan(`Action ID: ${chalk.bold(actionId)}`));

        this.processedEvents.add(eventId);
      }
    );
  }

  async relayAction(sourceChain, destChain, event) {
    try {
      const block = await sourceChain.provider.getBlock(event.log.blockNumber);
      const receipt = await event.log.getTransactionReceipt();
      const positionInBlock = receipt.index;

      console.log(chalk.yellow(`\n>  Requesting proof from Polymer API...`));

      // Request proof generation
      const proofRequest = await axios.post(
        POLYMER_API_URL,
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
            Authorization: `Bearer ${process.env.POLYMER_API_KEY}`,
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

      // Check proof after 10 seconds for the first time, then every 5 seconds
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
          POLYMER_API_URL,
          {
            jsonrpc: "2.0",
            id: 1,
            method: "receipt_queryProof",
            params: [jobId],
          },
          {
            headers: {
              Authorization: `Bearer ${process.env.POLYMER_API_KEY}`,
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
      const validateTx = await destChain.contract.validateProof(0, proofBytes);
      const validateReceipt = await validateTx.wait();
      console.log(chalk.green("✅ Proof validated"));

      // Get the validated action ID
      const validatedEvent = validateReceipt.logs
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

  const relayer = new SimpleRelayer(chainAConfig, chainBConfig, wallet);
  await relayer.start();
}

main().catch((error) => {
  console.error(chalk.red("Error in main:"), error);
  process.exit(1);
});

process.on("unhandledRejection", (error) => {
  console.error(chalk.red("Unhandled promise rejection:"), error);
});

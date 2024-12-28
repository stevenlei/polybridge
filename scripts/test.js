require("dotenv").config();
const hre = require("hardhat");
const chalk = require("chalk");

// Contract ABI
const CONTRACT_ABI =
  require("../artifacts/contracts/ExampleContract.sol/ExampleContract.json").abi;

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForBridgeCompletion(
  contract,
  sourceActionId,
  maxAttempts = 60
) {
  console.log(chalk.yellow("\nWaiting for relayer to process..."));
  let destinationActionId = null;

  // First wait for ActionValidated event to get the destination actionId
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      // Check for ActionValidated events
      const filter = contract.filters.ActionValidated();
      const events = await contract.queryFilter(filter, -100); // Last 100 blocks

      for (const event of events) {
        // Check if this event is related to our action
        const [destActionId, initiator, proofHash] = event.args;
        if (!destinationActionId) {
          console.log(chalk.cyan("Found validated action:", destActionId));
          destinationActionId = destActionId;
        }

        // Now wait for the string to be updated with this actionId
        const [value, state, timestamp] = await contract.getString(
          destinationActionId
        );

        if (value !== "") {
          // Check for completion event
          const completedFilter =
            contract.filters.StringUpdateCompleted(destinationActionId);
          const completedEvents = await contract.queryFilter(completedFilter);

          if (completedEvents.length > 0) {
            console.log(chalk.green("\nString update completed successfully!"));
            console.log(chalk.cyan("Final string value on Chain B:", value));
            return { success: true, destinationActionId };
          }
        }
      }

      console.log(
        chalk.yellow(
          `Waiting for validation... (attempt ${attempt + 1}/${maxAttempts})`
        )
      );

      await sleep(10000);
    } catch (error) {
      console.log(
        chalk.yellow(
          `Error checking status (attempt ${attempt + 1}/${maxAttempts}):`,
          error.message
        )
      );
      await sleep(5000);
    }
  }

  console.log(chalk.red("\nTimeout waiting for completion"));
  return { success: false, destinationActionId };
}

async function main() {
  // Get the network configurations
  const CHAINS = require("../config/chains");
  const chainA = CHAINS[process.env.CHAIN_A];
  const chainB = CHAINS[process.env.CHAIN_B];

  if (!chainA || !chainB) {
    throw new Error("Please set CHAIN_A and CHAIN_B in .env");
  }

  console.log(
    chalk.blue(`Testing bridge between ${chainA.name} and ${chainB.name}`)
  );

  // Connect to Chain A
  const providerA = new hre.ethers.JsonRpcProvider(chainA.rpcUrl);
  const walletA = new hre.ethers.Wallet(process.env.PRIVATE_KEY, providerA);
  const contractA = new hre.ethers.Contract(
    chainA.contractAddress,
    CONTRACT_ABI,
    walletA
  );

  // Connect to Chain B
  const providerB = new hre.ethers.JsonRpcProvider(chainB.rpcUrl);
  const walletB = new hre.ethers.Wallet(process.env.PRIVATE_KEY, providerB);
  const contractB = new hre.ethers.Contract(
    chainB.contractAddress,
    CONTRACT_ABI,
    walletB
  );

  // Test string to update
  const testString = "Hello from Chain A! " + new Date().toISOString();

  try {
    console.log(chalk.yellow("Initiating string update on Chain A..."));
    const tx = await contractA.updateString(testString);
    console.log(chalk.cyan("Transaction sent:", tx.hash));

    const receipt = await tx.wait();
    console.log(chalk.green("Transaction confirmed!"));

    // Get the source actionId from the event
    const event = receipt.logs.find(
      (log) =>
        log.topics[0] ===
        contractA.interface.getEvent("StringUpdateStarted").topicHash
    );
    const sourceActionId = event.topics[1];
    console.log(chalk.cyan("Source Action ID:", sourceActionId));

    // Get the string value from Chain A
    const [valueA] = await contractA.getString(sourceActionId);
    console.log(chalk.cyan("String value on Chain A:", valueA));

    // Wait for completion
    const { success, destinationActionId } = await waitForBridgeCompletion(
      contractB,
      sourceActionId
    );

    if (success && destinationActionId) {
      // Compare final values
      const [valueA] = await contractA.getString(sourceActionId);
      const [valueB] = await contractB.getString(destinationActionId);
      console.log(chalk.cyan("\nFinal string values:"));
      console.log(chalk.cyan("Chain A:", valueA));
      console.log(chalk.cyan("Chain B:", valueB));
    }

    process.exit(success ? 0 : 1);
  } catch (error) {
    console.error(chalk.red("Error:"), error);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(chalk.red("Error in main:"), error);
  process.exit(1);
});

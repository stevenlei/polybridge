require("dotenv").config();
const hre = require("hardhat");
const { ethers } = require("hardhat");
const chalk = require("chalk");

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function setupNumberUpdateListener(contract, chainName, highestNumber) {
  contract.on("NumberUpdated", async (oldValue, newValue, step) => {
    console.log(chalk.yellow(`\n${chainName} Update (${step}):`));

    if (step === "step1") {
      console.log(
        chalk.grey(
          "Update the number to 1 on Chain A, and call the bridge() function to execute the increment function on Chain B"
        )
      );
    } else if (step === "step2") {
      console.log(
        chalk.grey(
          "the number get incremented on Chain B, and call the bridge() function to execute the increment function on Chain A"
        )
      );
    } else if (step === "step3") {
      console.log(chalk.grey("Finally, the number get incremented on Chain A"));
    }

    console.log(chalk.cyan(`Value: ${newValue}`));

    if (newValue > highestNumber.value) {
      highestNumber.value = newValue;
    }

    if (highestNumber.value >= 3) {
      console.log(
        chalk.green("\n✅ Number has reached 3! Test completed successfully!")
      );
      process.exit(0);
    }
  });
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
  const providerA = new ethers.JsonRpcProvider(chainA.rpcUrl);
  const walletA = new ethers.Wallet(process.env.PRIVATE_KEY, providerA);
  const contractA = new ethers.Contract(
    chainA.contractAddress,
    require("../artifacts/contracts/example/CrossChainCounter.sol/CrossChainCounter.json").abi,
    walletA
  );

  // Connect to Chain B
  const providerB = new ethers.JsonRpcProvider(chainB.rpcUrl);
  const walletB = new ethers.Wallet(process.env.PRIVATE_KEY, providerB);
  const contractB = new ethers.Contract(
    chainB.contractAddress,
    require("../artifacts/contracts/example/CrossChainCounter.sol/CrossChainCounter.json").abi,
    walletB
  );

  try {
    // Set up event listeners for both chains
    console.log(chalk.yellow("\nSetting up event listeners..."));

    // Track the highest number we've seen (using an object for reference sharing)
    const highestNumber = { value: 0 };

    // Set up listeners for both chains
    setupNumberUpdateListener(contractA, "Chain A", highestNumber);
    setupNumberUpdateListener(contractB, "Chain B", highestNumber);

    // Start the chain on Contract A
    console.log(chalk.yellow("\nInitiating first number update on Chain A..."));
    const tx1 = await contractA.updateNumberStep1_calledByClientOnChainA(1);
    await tx1.wait();

    // Keep the script running
    await new Promise((resolve) => {
      setTimeout(() => {
        console.log(chalk.red("\n❌ Test timed out after 10 minutes!"));
        process.exit(1);
      }, 60 * 10 * 1000); // 10 minutes timeout
    });
  } catch (error) {
    console.error(chalk.red("\nError during test:"), error);
    process.exit(1);
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });

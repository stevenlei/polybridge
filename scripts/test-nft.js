require("dotenv").config();
const hre = require("hardhat");
const { ethers } = require("hardhat");
const chalk = require("chalk");

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function showBalances(
  contractA,
  contractB,
  walletAddress,
  chainAName,
  chainBName
) {
  const balanceA = await contractA.balanceOf(walletAddress);
  const balanceB = await contractB.balanceOf(walletAddress);

  console.log(chalk.blue("\n📊 NFT Balances:"));
  console.log(chalk.cyan(`${chainAName}: ${balanceA} NFTs`));
  console.log(chalk.cyan(`${chainBName}: ${balanceB} NFTs`));
}

function setupNFTEventListener(
  contract,
  chainName,
  contractA,
  contractB,
  walletAddress,
  bridgeEvents,
  resolve
) {
  // Listen for NFT minting and transfers
  contract.on("Transfer", async (from, to, tokenId) => {
    const zeroAddress = "0x0000000000000000000000000000000000000000";
    if (from === zeroAddress) {
      if (chainName === "Chain B") {
        console.log(chalk.inverse("\nStep 2b: Minted on Chain B (By Relayer)"));
      }

      console.log(chalk.green(`\n✅ ${chainName} Minted:`));
      console.log(chalk.cyan(`Token ID: ${tokenId} minted to ${to}`));
      await showBalances(
        contractA,
        contractB,
        walletAddress,
        "Chain A",
        "Chain B"
      );
    } else if (to === zeroAddress) {
      console.log(chalk.inverse("\nStep 3: Burn and Unlock (By Relayer)"));
      // Step 3a: Burn NFT on Chain A
      console.log(chalk.inverse("\nStep 3a: Burn NFT on Chain A (By Relayer)"));
      console.log(chalk.red(`\n🔥 ${chainName} Burned:`));
      console.log(chalk.cyan(`Token ID: ${tokenId} burned from ${from}`));
      await showBalances(
        contractA,
        contractB,
        walletAddress,
        "Chain A",
        "Chain B"
      );
    }
  });

  // Listen for NFT locking and unlocking
  contract.on("NFTLocked", async (tokenId, owner, chain) => {
    if (chain === "Chain A") {
      console.log(chalk.inverse("\nStep 2a: Lock NFT on Chain A"));
    } else {
      console.log(chalk.inverse("\nStep 2c: Lock NFT on Chain B (By Relayer)"));
    }
    console.log(chalk.gray(`\n🔒 ${chain} Locked:`));
    console.log(chalk.cyan(`Token ID: ${tokenId} locked by ${owner}`));
  });

  contract.on("NFTUnlocked", async (tokenId, owner, chain) => {
    console.log(chalk.inverse("\nStep 3b: Unlock NFT on Chain B (By Relayer)"));
    console.log(chalk.gray(`\n🔓 ${chain} Unlocked:`));
    console.log(chalk.cyan(`Token ID: ${tokenId} unlocked for ${owner}`));

    // Show final balances and completion message after unlock
    await showBalances(
      contractA,
      contractB,
      walletAddress,
      "Chain A",
      "Chain B"
    );
    console.log(chalk.green("\n✨ NFT Bridge process completed successfully!"));

    // Final step of the bridge process
    bridgeEvents.unlockOnChainB = true;
    resolve();
  });

  // Listen for bridge events
  contract.on("NFTBridged", async (tokenId, owner, step) => {
    console.log(chalk.green(`\n🚀 ${chainName} Bridged (${step}):`));
    console.log(chalk.cyan(`Token ID: ${tokenId} for ${owner}`));

    if (step === "minted on chain B") {
      bridgeEvents.mintOnChainB = true;
    }
    if (step === "burned on chain A") {
      bridgeEvents.burnOnChainA = true;
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
    chalk.blue(`Testing NFT bridge between ${chainA.name} and ${chainB.name}`)
  );

  // Connect to Chain A
  const providerA = new ethers.JsonRpcProvider(chainA.rpcUrl);
  const walletA = new ethers.Wallet(process.env.PRIVATE_KEY, providerA);
  const contractA = new ethers.Contract(
    chainA.contractAddress,
    require("../artifacts/contracts/example/CrossChainNFT.sol/CrossChainNFT.json").abi,
    walletA
  );

  // Connect to Chain B
  const providerB = new ethers.JsonRpcProvider(chainB.rpcUrl);
  const walletB = new ethers.Wallet(process.env.PRIVATE_KEY, providerB);
  const contractB = new ethers.Contract(
    chainB.contractAddress,
    require("../artifacts/contracts/example/CrossChainNFT.sol/CrossChainNFT.json").abi,
    walletB
  );

  try {
    // Set up event listeners for both chains
    console.log(chalk.yellow("\nSetting up event listeners..."));

    // Create a shared object to track bridge events
    const bridgeEvents = {
      mintOnChainB: false,
      burnOnChainA: false,
      unlockOnChainB: false,
    };

    // Create a promise that resolves when the bridge process is complete
    const bridgeComplete = new Promise((resolve) => {
      setupNFTEventListener(
        contractA,
        "Chain A",
        contractA,
        contractB,
        walletA.address,
        bridgeEvents,
        resolve
      );
      setupNFTEventListener(
        contractB,
        "Chain B",
        contractA,
        contractB,
        walletA.address,
        bridgeEvents,
        resolve
      );
    });

    // Show initial balances
    console.log(chalk.inverse("\nInitial balances:"));
    await showBalances(
      contractA,
      contractB,
      walletA.address,
      "Chain A",
      "Chain B"
    );

    // Step 1: Mint NFT on Chain A
    console.log(chalk.inverse("\nStep 1: Mint NFT on Chain A (By Client)..."));
    const mintTx = await contractA.mintOnChainA();
    const mintReceipt = await mintTx.wait();

    // Get the token ID from the Transfer event
    const transferEvent = mintReceipt.logs.find(
      (log) => log.fragment && log.fragment.name === "Transfer"
    );
    const tokenId = transferEvent.args[2]; // tokenId is the third argument

    // Wait a bit to ensure minting is complete
    await sleep(2000);

    // Step 2: Bridge NFT from Chain A to Chain B
    console.log(
      chalk.inverse("\nStep 2: Bridge NFT to Chain B (By Client)...")
    );
    const bridgeTx = await contractA.bridgeToChainB(tokenId);
    await bridgeTx.wait();

    // Wait for the bridge process to complete
    console.log(chalk.yellow("\nWaiting for bridge events..."));

    // Set up timeout
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => {
        reject(new Error("Bridge process timed out after 10 minutes"));
      }, 60 * 10 * 1000);
    });

    // Wait for either completion or timeout
    await Promise.race([bridgeComplete, timeoutPromise]);
    process.exit(0);
  } catch (error) {
    console.error(chalk.red("\nError during test:"), error);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

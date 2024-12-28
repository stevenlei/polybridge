require("dotenv").config();

const CHAINS = {
  "optimism-sepolia": {
    name: "Optimism Sepolia",
    rpcUrl: process.env.OPTIMISM_SEPOLIA_RPC,
    contractAddress: process.env.OPTIMISM_SEPOLIA_CONTRACT_ADDRESS,
    chainId: 11155420,
  },
  "base-sepolia": {
    name: "Base Sepolia",
    rpcUrl: process.env.BASE_SEPOLIA_RPC,
    contractAddress: process.env.BASE_SEPOLIA_CONTRACT_ADDRESS,
    chainId: 84532,
  },
};

module.exports = CHAINS;

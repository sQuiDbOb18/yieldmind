require("@nomicfoundation/hardhat-toolbox");
require("dotenv").config();

// THIS is the key fix
require("ts-node").register();

module.exports = {
  solidity: "0.8.20",
  networks: {
    mantleTestnet: {
      url: "https://rpc.sepolia.mantle.xyz",
      accounts: process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : [],
    },
  },
};
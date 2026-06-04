const { ethers } = require("hardhat");

async function main() {
  console.log("Deploying YieldVault...");

  const YieldVault = await ethers.getContractFactory("YieldVault");
  const vault = await YieldVault.deploy();

  await vault.waitForDeployment();

  const address = await vault.getAddress();
  console.log("YieldVault deployed to:", address);
  console.log("Save this address — you need it for submission!");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
import { ethers } from "hardhat";

async function main() {
  const vault = await ethers.deployContract("YieldVault");
  await vault.waitForDeployment();

  console.log(await vault.getAddress());
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

import { expect } from "chai";
import { ethers } from "hardhat";
import { anyValue } from "@nomicfoundation/hardhat-chai-matchers/withArgs";
import type { ContractTransactionResponse, Signer } from "ethers";

type YieldVaultContract = Awaited<ReturnType<typeof ethers.deployContract>> & {
  balances(address: string): Promise<bigint>;
  connect(signer: Signer): YieldVaultContract;
  currentAllocation(): Promise<string>;
  deposit(overrides: { value: bigint }): Promise<ContractTransactionResponse>;
  rebalance(newAllocation: string, reason: string): Promise<ContractTransactionResponse>;
  totalDeposits(): Promise<bigint>;
  withdraw(amount: bigint): Promise<ContractTransactionResponse>;
};

describe("YieldVault", function () {
  async function deployVault() {
    const [owner, user] = await ethers.getSigners();
    const vault = (await ethers.deployContract("YieldVault")) as YieldVaultContract;

    return { owner, user, vault };
  }

  it("accepts deposits and withdrawals", async function () {
    const { user, vault } = await deployVault();
    const amount = ethers.parseEther("1");
    const userVault = vault.connect(user) as YieldVaultContract;

    await expect(userVault.deposit({ value: amount }))
      .to.emit(vault, "Deposited")
      .withArgs(user.address, amount);

    expect(await vault.balances(user.address)).to.equal(amount);
    expect(await vault.totalDeposits()).to.equal(amount);

    await expect(userVault.withdraw(amount))
      .to.emit(vault, "Withdrawn")
      .withArgs(user.address, amount);

    expect(await vault.balances(user.address)).to.equal(0n);
    expect(await vault.totalDeposits()).to.equal(0n);
  });

  it("limits rebalancing to the owner", async function () {
    const { user, vault } = await deployVault();
    const userVault = vault.connect(user) as YieldVaultContract;

    await expect(userVault.rebalance("mETH", "mETH leads by 0.65%")).to.be.revertedWith("Not authorized");
  });

  it("updates the allocation when the owner rebalances", async function () {
    const { vault } = await deployVault();

    await expect(vault.rebalance("mETH", "mETH leads by 0.65%"))
      .to.emit(vault, "Rebalanced")
      .withArgs("USDY", "mETH", anyValue, "mETH leads by 0.65%");

    expect(await vault.currentAllocation()).to.equal("mETH");
  });
});

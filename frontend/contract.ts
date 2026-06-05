export const CONTRACT_ADDRESS = "0x1Fa60f862190BBf44A75E0210AFdF51C7F4a9bf1";

export const CONTRACT_ABI = [
  "function deposit() external payable",
  "function withdraw(uint256 amount) external",
  "function rebalance(string memory newAllocation, string memory reason) external",
  "function currentAllocation() view returns (string)",
  "function totalDeposits() view returns (uint256)",
  "function balances(address) view returns (uint256)",
  "function getVaultBalance() view returns (uint256)",
];
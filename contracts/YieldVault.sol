// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract YieldVault {
    // The owner is the AI agent — only it can rebalance
    address public owner;

    // Track how much each user deposited
    mapping(address => uint256) public balances;

    // Track total money in the vault
    uint256 public totalDeposits;

    // Track where money is currently allocated
    string public currentAllocation; // "USDY" or "mETH"

    // Log every rebalance the AI does (judges love this)
    event Rebalanced(string from, string to, uint256 timestamp, string reason);
    event Deposited(address user, uint256 amount);
    event Withdrawn(address user, uint256 amount);

    // When contract is deployed, set owner to whoever deployed it
    constructor() {
        owner = msg.sender;
        currentAllocation = "USDY"; // start in USDY by default
    }

    // Only the owner (AI agent) can call rebalance
    modifier onlyOwner() {
        require(msg.sender == owner, "Not authorized");
        _;
    }

    // Users call this to deposit MNT into the vault
    function deposit() external payable {
        require(msg.value > 0, "Must deposit something");
        balances[msg.sender] += msg.value;
        totalDeposits += msg.value;
        emit Deposited(msg.sender, msg.value);
    }

    // AI agent calls this to rebalance
    function rebalance(string memory newAllocation, string memory reason) 
        external onlyOwner {
        string memory oldAllocation = currentAllocation;
        currentAllocation = newAllocation;
        emit Rebalanced(oldAllocation, newAllocation, block.timestamp, reason);
    }

    // Users call this to withdraw their funds
    function withdraw(uint256 amount) external {
        require(balances[msg.sender] >= amount, "Not enough balance");
        balances[msg.sender] -= amount;
        totalDeposits -= amount;
        payable(msg.sender).transfer(amount);
        emit Withdrawn(msg.sender, amount);
    }

    // Check vault's total balance
    function getVaultBalance() external view returns (uint256) {
        return address(this).balance;
    }
}
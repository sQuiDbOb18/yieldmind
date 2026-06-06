// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract YieldVault {
    address public owner;
    mapping(address => uint256) public balances;
    uint256 public totalDeposits;
    string public currentAllocation;

    event Rebalanced(string from, string to, uint256 timestamp, string reason);
    event Deposited(address user, uint256 amount);
    event Withdrawn(address user, uint256 amount);

    constructor() {
        owner = msg.sender;
        currentAllocation = "USDY";
    }

    modifier onlyOwner() {
        require(msg.sender == owner, "Not authorized");
        _;
    }

    function deposit() external payable {
        require(msg.value > 0, "Must deposit something");
        balances[msg.sender] += msg.value;
        totalDeposits += msg.value;
        emit Deposited(msg.sender, msg.value);
    }

    function rebalance(string memory newAllocation, string memory reason) external onlyOwner {
        bytes32 allocationHash = keccak256(bytes(newAllocation));
        require(
            allocationHash == keccak256(bytes("USDY")) || allocationHash == keccak256(bytes("mETH")),
            "Unsupported allocation"
        );

        string memory oldAllocation = currentAllocation;
        currentAllocation = newAllocation;
        emit Rebalanced(oldAllocation, newAllocation, block.timestamp, reason);
    }

    function withdraw(uint256 amount) external {
        require(balances[msg.sender] >= amount, "Not enough balance");
        balances[msg.sender] -= amount;
        totalDeposits -= amount;
        payable(msg.sender).transfer(amount);
        emit Withdrawn(msg.sender, amount);
    }

    function getVaultBalance() external view returns (uint256) {
        return address(this).balance;
    }
}

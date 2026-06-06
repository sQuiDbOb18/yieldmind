# YieldMind — AI-Powered Yield Optimizer on Mantle

[![Mantle Network](https://img.shields.io/badge/Network-Mantle-00ff88)](https://www.mantle.xyz/)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

**Let AI manage your yield. Always earning more.**

## Overview

YieldMind is an autonomous yield optimization protocol built on Mantle Network. Users deposit MNT into a smart contract vault. An AI agent monitors yield rates across Mantle-native assets — mETH and USDY — every hour and automatically rebalances the vault allocation to whichever asset offers the highest return. Every rebalance decision is recorded on-chain for full transparency.

## Problem

DeFi yield rates change constantly. Most users either leave funds in a suboptimal asset or waste time manually monitoring and moving funds. There is no autonomous, transparent, on-chain solution for yield optimization on Mantle.

## Solution

YieldMind deploys a three-layer architecture: a Solidity vault contract, an AI agent, and a React dashboard. The agent runs continuously, fetches live APY data, makes allocation decisions, and executes rebalances via the smart contract. Users simply deposit and let the AI do the rest.

## How It Works

1. User deposits MNT into the YieldVault smart contract.
2. AI agent fetches mETH APY and USDY APY every hour.
3. If the spread between assets exceeds 0.5%, agent calls `rebalance()` on the contract.
4. Allocation switches automatically, and the decision is recorded on-chain with timestamp and reason.

## Tech Stack

- **Smart Contract:** Solidity, Hardhat, deployed on Mantle Testnet
- **AI Agent:** Node.js, ethers.js, node-cron, axios
- **Frontend:** Next.js, Tailwind CSS, wagmi, viem
- **Network:** Mantle Testnet (`chainId 5003`)

## Contract Details

- **Network:** Mantle Sepolia Testnet
- **Contract Address:** `0x1Fa60f862190BBf44A75E0210AFdF51C7F4a9bf1`
- **Explorer:** https://explorer.sepolia.mantle.xyz

## Getting Started

1. Clone the repo.

```bash
git clone <repo-url>
cd yieldmind
```

2. Install dependencies in the root, agent, and frontend folders.

```bash
npm install
cd agent && npm install
cd ../frontend && npm install
cd ..
```

3. Create a `.env` file in the project root.

```bash
PRIVATE_KEY=your_key
```

4. Run the AI agent.

```bash
cd agent
node agent.js
```

5. Run the frontend.

```bash
cd frontend
npm run dev
```

6. Open the dashboard.

```text
http://localhost:3000
```

## Roadmap

- **Phase 1 (current):** Vault contract + AI agent + dashboard on Mantle testnet
- **Phase 2:** Direct integration with Mantle mETH and USDY token contracts for real fund movement
- **Phase 3:** Multi-asset support, yield history charts, mobile app
- **Phase 4:** Mainnet deployment with audited contracts

## Live Demo

- **Frontend:** `https://yieldmind-cqenitsff-jamess-projects1.vercel.app`
- **Contract:** `https://explorer.sepolia.mantle.xyz/address/0x1Fa60f8621908Bf44A75E0210AFdf51C7F4a9bf1`

const { ethers } = require("ethers");
const cron = require("node-cron");
const axios = require("axios");
require("dotenv").config({ path: "../.env" });

// ← Paste your deployed contract address here
const CONTRACT_ADDRESS = "0x1Fa60f862190BBf44A75E0210AFdF51C7F4a9bf1";

// This is your contract's ABI — tells the agent what functions exist
const ABI = [
  "function rebalance(string memory newAllocation, string memory reason) external",
  "function currentAllocation() view returns (string)",
  "function totalDeposits() view returns (uint256)",
];

// Connect to Mantle testnet
const provider = new ethers.JsonRpcProvider("https://rpc.sepolia.mantle.xyz");
const wallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);
const contract = new ethers.Contract(CONTRACT_ADDRESS, ABI, wallet);

// ---- FETCH YIELD RATES ----
async function getYieldRates() {
  try {
    // Fetch mETH staking APY from Mantle
    const methResponse = await axios.get(
      "https://api.mantle.xyz/api/v1/meth/apy"
    );
    const methAPY = methResponse.data?.apy || 4.5; // fallback to 4.5% if API fails

    // USDY yield is relatively stable around 4-5% — we'll use a public API
    const usdyAPY = 4.8; // USDY typically tracks T-bill rates ~4.8%

    console.log(`📊 Current Rates — mETH: ${methAPY}% | USDY: ${usdyAPY}%`);

    return { methAPY, usdyAPY };
  } catch (error) {
    console.log("⚠️ Could not fetch live rates, using defaults");
    return { methAPY: 4.5, usdyAPY: 4.8 };
  }
}

// ---- MAIN REBALANCE LOGIC ----
async function checkAndRebalance() {
  console.log("\n🤖 Agent running at:", new Date().toLocaleString());

  try {
    // Get current allocation from contract
    const currentAllocation = await contract.currentAllocation();
    console.log("📍 Current allocation:", currentAllocation);

    // Get yield rates
    const { methAPY, usdyAPY } = await getYieldRates();

    // Decision logic — only move if difference is more than 0.5%
    const THRESHOLD = 0.5;
    let newAllocation = currentAllocation;
    let reason = "No rebalance needed";

    if (methAPY > usdyAPY + THRESHOLD && currentAllocation !== "mETH") {
      newAllocation = "mETH";
      reason = `mETH APY (${methAPY}%) is ${(methAPY - usdyAPY).toFixed(2)}% higher than USDY`;
    } else if (usdyAPY > methAPY + THRESHOLD && currentAllocation !== "USDY") {
      newAllocation = "USDY";
      reason = `USDY APY (${usdyAPY}%) is ${(usdyAPY - methAPY).toFixed(2)}% higher than mETH`;
    }

    // If rebalance needed, call the contract
    if (newAllocation !== currentAllocation) {
      console.log(`🔄 Rebalancing: ${currentAllocation} → ${newAllocation}`);
      console.log(`📝 Reason: ${reason}`);

      const tx = await contract.rebalance(newAllocation, reason);
      await tx.wait();

      console.log("✅ Rebalanced successfully! TX:", tx.hash);
    } else {
      console.log("✅ No rebalance needed — staying in", currentAllocation);
    }
  } catch (error) {
    console.error("❌ Agent error:", error.message);
  }
}

// ---- START THE AGENT ----
console.log("🚀 YieldMind Agent starting...");
console.log("⏰ Will check yields every hour");

// Run immediately on startup
checkAndRebalance();

// Then run every hour (at minute 0 of every hour)
cron.schedule("0 * * * *", checkAndRebalance);
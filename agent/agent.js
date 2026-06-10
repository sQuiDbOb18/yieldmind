const fs = require("node:fs");
const path = require("node:path");
const axios = require("axios");
const cron = require("node-cron");
const { ethers } = require("ethers");
require("dotenv").config({ path: path.resolve(__dirname, "../.env") });

const RPC_URLS = ["https://rpc.sepolia.mantle.xyz", "https://mantle-sepolia.drpc.org"];
const CONTRACT_FILE = path.resolve(__dirname, "../frontend/contract.ts");
const REBALANCE_THRESHOLD = 0.5;
const CHECK_INTERVAL = "0 * * * *";
const FALLBACK_METH_APY = 5.18;
const FALLBACK_USDY_APY = 4.72;
const ASSETS = {
  meth: "mETH",
  usdy: "USDY",
};

const ABI = [
  "function rebalance(string memory newAllocation, string memory reason) external",
  "function currentAllocation() view returns (string)",
  "function totalDeposits() view returns (uint256)",
];

function loadContractAddress() {
  const source = fs.readFileSync(CONTRACT_FILE, "utf8");
  const match = source.match(/CONTRACT_ADDRESS\s*=\s*"([^"]+)"/);

  if (!match) {
    throw new Error("CONTRACT_ADDRESS is missing from frontend/contract.ts");
  }

  return ethers.getAddress(match[1]);
}

function requirePrivateKey() {
  const privateKey = process.env.PRIVATE_KEY?.trim();

  if (!privateKey) {
    throw new Error("PRIVATE_KEY is missing from .env");
  }

  return privateKey;
}

function toApy(value) {
  const apy = Number(value);

  if (!Number.isFinite(apy) || apy < 0) {
    return null;
  }

  return apy;
}

async function fetchMethApy() {
  try {
    const response = await axios.get("https://meth.mantle.xyz/api/v1/apy", { timeout: 10000 });
    const candidates = [
      response.data?.apy,
      response.data?.data?.apy,
      response.data?.data?.stakingApy,
      response.data?.stakingApy,
    ];

    for (const candidate of candidates) {
      const apy = toApy(candidate);

      if (apy !== null) {
        return apy;
      }
    }

    throw new Error("mETH APY response did not include a numeric rate");
  } catch (error) {
    console.error(`mETH APY fetch failed, using fallback ${FALLBACK_METH_APY}%: ${error.message}`);
    return FALLBACK_METH_APY;
  }
}

async function fetchUsdyApy() {
  try {
    const response = await axios.get("https://yields.llama.fi/pools", { timeout: 15000 });
    const pools = response.data?.data;

    if (!Array.isArray(pools)) {
      throw new Error("USDY APY response did not include pools");
    }

    const pool = pools
      .filter((item) => {
        const symbol = String(item.symbol ?? "").toUpperCase();
        const project = String(item.project ?? "").toLowerCase();
        return symbol.includes("USDY") || project.includes("ondo");
      })
      .sort((left, right) => Number(right.tvlUsd ?? 0) - Number(left.tvlUsd ?? 0))[0];

    const apy = toApy(pool?.apy);

    if (apy === null) {
      throw new Error("USDY APY response did not include a numeric rate");
    }

    return apy;
  } catch (error) {
    console.error(`USDY APY fetch failed, using fallback ${FALLBACK_USDY_APY}%: ${error.message}`);
    return FALLBACK_USDY_APY;
  }
}

async function getYieldRates() {
  const [methApy, usdyApy] = await Promise.all([fetchMethApy(), fetchUsdyApy()]);
  return { methApy, usdyApy };
}

function pickAllocation(currentAllocation, rates) {
  const spread = rates.methApy - rates.usdyApy;
  const absoluteSpread = Math.abs(spread);

  if (absoluteSpread <= REBALANCE_THRESHOLD) {
    return null;
  }

  const target = spread > 0 ? ASSETS.meth : ASSETS.usdy;

  if (currentAllocation === target) {
    return null;
  }

  const leader = target;
  const laggard = target === ASSETS.meth ? ASSETS.usdy : ASSETS.meth;

  return {
    target,
    reason: `${leader} yield leads ${laggard} by ${absoluteSpread.toFixed(2)}%`,
  };
}

async function checkAndRebalance(contract) {
  const startedAt = new Date().toISOString();
  console.log(`YieldMind hourly check at ${startedAt}`);

  try {
    const currentAllocation = await contract.currentAllocation();
    const rates = await getYieldRates();
    const decision = pickAllocation(currentAllocation, rates);

    console.log(
      `Rates: mETH ${rates.methApy.toFixed(2)}%, USDY ${rates.usdyApy.toFixed(2)}%, allocation ${currentAllocation}`,
    );

    if (!decision) {
      console.log("No rebalance submitted");
      return;
    }

    console.log(`Rebalancing to ${decision.target}: ${decision.reason}`);
    const transaction = await contract.rebalance(decision.target, decision.reason);
    const receipt = await transaction.wait();
    console.log(`Rebalance confirmed in block ${receipt.blockNumber}: ${transaction.hash}`);
  } catch (error) {
    console.error(`Agent check failed: ${error.message}`);
  }
}

function createContract() {
  const provider = new ethers.FallbackProvider(RPC_URLS.map((url) => new ethers.JsonRpcProvider(url)));
  const wallet = new ethers.Wallet(requirePrivateKey(), provider);
  return new ethers.Contract(loadContractAddress(), ABI, wallet);
}

async function run() {
  console.log("YieldMind agent is running");

  const contract = createContract();

  await checkAndRebalance(contract);

  cron.schedule(CHECK_INTERVAL, () => {
    checkAndRebalance(contract);
  });
}

run().catch((error) => {
  console.error(`YieldMind agent failed to start: ${error.message}`);
  process.exitCode = 1;
});

"use client";
import { useState } from "react";
import { useAccount, useConnect, useDisconnect, useReadContract, useWriteContract, useBalance } from "wagmi";
import { injected } from "wagmi/connectors";
import { parseEther, formatEther } from "viem";
import { CONTRACT_ADDRESS, CONTRACT_ABI } from "../contract";

export default function Home() {
  const [depositAmount, setDepositAmount] = useState("");
  const [withdrawAmount, setWithdrawAmount] = useState("");

  const { address, isConnected } = useAccount();
  const { connect } = useConnect();
  const { disconnect } = useDisconnect();
  const { writeContract } = useWriteContract();

  // Read contract data
  const { data: currentAllocation } = useReadContract({
    address: CONTRACT_ADDRESS as `0x${string}`,
    abi: CONTRACT_ABI,
    functionName: "currentAllocation",
  });

  const { data: totalDeposits } = useReadContract({
    address: CONTRACT_ADDRESS as `0x${string}`,
    abi: CONTRACT_ABI,
    functionName: "totalDeposits",
  });

  const { data: userBalance } = useReadContract({
    address: CONTRACT_ADDRESS as `0x${string}`,
    abi: CONTRACT_ABI,
    functionName: "balances",
    args: [address],
  });

  const { data: walletBalance } = useBalance({ address });

  // Deposit function
  function handleDeposit() {
    if (!depositAmount) return;
    writeContract({
      address: CONTRACT_ADDRESS as `0x${string}`,
      abi: CONTRACT_ABI,
      functionName: "deposit",
      value: parseEther(depositAmount),
    });
  }

  // Withdraw function
  function handleWithdraw() {
    if (!withdrawAmount) return;
    writeContract({
      address: CONTRACT_ADDRESS as `0x${string}`,
      abi: CONTRACT_ABI,
      functionName: "withdraw",
      args: [parseEther(withdrawAmount)],
    });
  }

  // Not connected screen
  if (!isConnected) {
    return (
      <main className="min-h-screen bg-black flex items-center justify-center">
        <div className="text-center">
          <h1 className="text-5xl font-bold text-white mb-2">YieldMind</h1>
          <p className="text-gray-400 mb-8">AI-powered yield optimizer on Mantle</p>
          <button
            onClick={() => connect({ connector: injected() })}
            className="bg-green-500 hover:bg-green-400 text-black font-bold px-8 py-4 rounded-xl text-lg transition"
          >
            Connect Wallet
          </button>
        </div>
      </main>
    );
  }

  // Connected dashboard
  return (
    <main className="min-h-screen bg-black text-white p-8">
      {/* Header */}
      <div className="flex justify-between items-center mb-10">
        <div>
          <h1 className="text-3xl font-bold text-green-400">YieldMind</h1>
          <p className="text-gray-400 text-sm">AI Yield Optimizer • Mantle Testnet</p>
        </div>
        <div className="text-right">
          <p className="text-gray-400 text-sm">
            {address?.slice(0, 6)}...{address?.slice(-4)}
          </p>
          <button
            onClick={() => disconnect()}
            className="text-red-400 text-sm hover:text-red-300"
          >
            Disconnect
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4 mb-8">
        <div className="bg-gray-900 rounded-xl p-5">
          <p className="text-gray-400 text-sm mb-1">Current Allocation</p>
          <p className="text-2xl font-bold text-green-400">
            {currentAllocation?.toString() || "Loading..."}
          </p>
          <p className="text-gray-500 text-xs mt-1">AI managed</p>
        </div>
        <div className="bg-gray-900 rounded-xl p-5">
          <p className="text-gray-400 text-sm mb-1">Your Deposit</p>
          <p className="text-2xl font-bold text-white">
            {userBalance ? parseFloat(formatEther(userBalance as bigint)).toFixed(4) : "0"} MNT
          </p>
          <p className="text-gray-500 text-xs mt-1">In vault</p>
        </div>
        <div className="bg-gray-900 rounded-xl p-5">
          <p className="text-gray-400 text-sm mb-1">Total Vault</p>
          <p className="text-2xl font-bold text-white">
            {totalDeposits ? parseFloat(formatEther(totalDeposits as bigint)).toFixed(4) : "0"} MNT
          </p>
          <p className="text-gray-500 text-xs mt-1">All deposits</p>
        </div>
      </div>

      {/* Deposit & Withdraw */}
      <div className="grid grid-cols-2 gap-4 mb-8">
        <div className="bg-gray-900 rounded-xl p-5">
          <h2 className="text-lg font-bold mb-4">Deposit</h2>
          <p className="text-gray-400 text-sm mb-2">
            Wallet: {walletBalance ? parseFloat(formatEther(walletBalance.value)).toFixed(4) : "0"} MNT
          </p>
          <input
            type="number"
            placeholder="Amount in MNT"
            value={depositAmount}
            onChange={(e) => setDepositAmount(e.target.value)}
            className="w-full bg-gray-800 text-white rounded-lg px-4 py-3 mb-3 outline-none focus:ring-2 focus:ring-green-500"
          />
          <button
            onClick={handleDeposit}
            className="w-full bg-green-500 hover:bg-green-400 text-black font-bold py-3 rounded-lg transition"
          >
            Deposit
          </button>
        </div>

        <div className="bg-gray-900 rounded-xl p-5">
          <h2 className="text-lg font-bold mb-4">Withdraw</h2>
          <p className="text-gray-400 text-sm mb-2">
            In vault: {userBalance ? parseFloat(formatEther(userBalance as bigint)).toFixed(4) : "0"} MNT
          </p>
          <input
            type="number"
            placeholder="Amount in MNT"
            value={withdrawAmount}
            onChange={(e) => setWithdrawAmount(e.target.value)}
            className="w-full bg-gray-800 text-white rounded-lg px-4 py-3 mb-3 outline-none focus:ring-2 focus:ring-green-500"
          />
          <button
            onClick={handleWithdraw}
            className="w-full bg-red-500 hover:bg-red-400 text-white font-bold py-3 rounded-lg transition"
          >
            Withdraw
          </button>
        </div>
      </div>

      {/* AI Status */}
      <div className="bg-gray-900 rounded-xl p-5">
        <h2 className="text-lg font-bold mb-2">🤖 AI Agent Status</h2>
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 bg-green-400 rounded-full animate-pulse"></div>
          <p className="text-gray-300 text-sm">
            Agent is active — checking yields every hour and rebalancing automatically
          </p>
        </div>
      </div>
    </main>
  );
}
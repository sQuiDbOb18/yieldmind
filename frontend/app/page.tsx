"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  useAccount,
  useBalance,
  useConnect,
  useDisconnect,
  usePublicClient,
  useReadContract,
  useWriteContract,
} from "wagmi";
import { injected } from "wagmi/connectors";
import { formatEther, parseAbiItem, parseEther } from "viem";
import { CONTRACT_ABI, CONTRACT_ADDRESS } from "../contract";

declare global {
  interface Window {
    ethereum?: unknown;
  }
}

type RebalanceRecord = {
  id: string;
  time: string;
  from: string;
  to: string;
  reason: string;
};

type YieldRates = {
  mETH: number;
  USDY: number;
};

const vaultAddress = CONTRACT_ADDRESS as `0x${string}`;
const zeroAddress = "0x0000000000000000000000000000000000000000" as const;
const rebalanceEvent = parseAbiItem(
  "event Rebalanced(string from, string to, uint256 timestamp, string reason)",
);

const fallbackYieldRates: YieldRates = {
  mETH: 5.18,
  USDY: 4.72,
};
const historyBlockWindow = BigInt(50000);
const zeroBlock = BigInt(0);

function formatMnt(value?: bigint) {
  if (!value) {
    return "0.0000";
  }

  return Number(formatEther(value)).toFixed(4);
}

function formatPercent(value: number) {
  return `${value.toFixed(2)}%`;
}

function toRate(value: unknown) {
  const rate = Number(value);
  return Number.isFinite(rate) && rate >= 0 ? rate : null;
}

async function fetchMethApy() {
  const response = await fetch("https://api.mantle.xyz/api/v1/meth/apy");
  const data = (await response.json()) as Record<string, unknown>;
  const nested = data.data && typeof data.data === "object" ? (data.data as Record<string, unknown>) : {};
  const candidates = [data.apy, data.stakingApy, nested.apy, nested.stakingApy];

  for (const candidate of candidates) {
    const rate = toRate(candidate);

    if (rate !== null) {
      return rate;
    }
  }

  throw new Error("mETH APY unavailable");
}

async function fetchUsdyApy() {
  const response = await fetch("https://yields.llama.fi/pools");
  const payload = (await response.json()) as { data?: unknown };
  const pools = Array.isArray(payload.data) ? payload.data : [];
  const pool = pools
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object")
    .filter((item) => {
      const symbol = String(item.symbol ?? "").toUpperCase();
      const project = String(item.project ?? "").toLowerCase();
      return symbol.includes("USDY") || project.includes("ondo");
    })
    .sort((left, right) => Number(right.tvlUsd ?? 0) - Number(left.tvlUsd ?? 0))[0];
  const rate = toRate(pool?.apy);

  if (rate === null) {
    throw new Error("USDY APY unavailable");
  }

  return rate;
}

export default function Home() {
  const [depositAmount, setDepositAmount] = useState("");
  const [withdrawAmount, setWithdrawAmount] = useState("");
  const [walletError, setWalletError] = useState("");
  const [minutesRemaining, setMinutesRemaining] = useState(60);
  const [history, setHistory] = useState<RebalanceRecord[]>([]);
  const [yieldRates, setYieldRates] = useState<YieldRates>(fallbackYieldRates);

  const publicClient = usePublicClient();
  const { address, isConnected } = useAccount();
  const { connect } = useConnect();
  const { disconnect } = useDisconnect();
  const { writeContractAsync } = useWriteContract();
  const [depositPending, setDepositPending] = useState(false);
  const [withdrawPending, setWithdrawPending] = useState(false);
  const [rebalancePending, setRebalancePending] = useState(false);
  const [rebalanceSuccess, setRebalanceSuccess] = useState(false);
  const [depositSuccess, setDepositSuccess] = useState("");
  const [withdrawSuccess, setWithdrawSuccess] = useState("");
  const queryClient = useQueryClient();

  const { data: currentAllocation } = useReadContract({
    address: vaultAddress,
    abi: CONTRACT_ABI,
    functionName: "currentAllocation",
    query: {
      refetchInterval: 4000,
    },
  });

  const { data: totalDeposits } = useReadContract({
    address: vaultAddress,
    abi: CONTRACT_ABI,
    functionName: "totalDeposits",
    query: {
      refetchInterval: 4000,
    },
  });

  const { data: userBalance } = useReadContract({
    address: vaultAddress,
    abi: CONTRACT_ABI,
    functionName: "balances",
    args: [address ?? zeroAddress],
    query: {
      enabled: Boolean(address),
      refetchInterval: 4000,
    },
  });

  const { data: walletBalance } = useBalance({
    address,
    query: {
      refetchInterval: 4000,
    },
  });

  const allocation = currentAllocation?.toString() ?? "Loading";
  const isMeth = allocation === "mETH";
  const canManualRebalance = allocation === "USDY" || allocation === "mETH";
  const nextAllocation = allocation === "USDY" ? "mETH" : "USDY";
  const methWidth = `${Math.min(100, (yieldRates.mETH / 6) * 100)}%`;
  const usdyWidth = `${Math.min(100, (yieldRates.USDY / 6) * 100)}%`;

  const shortAddress = useMemo(() => {
    if (!address) {
      return "";
    }

    return `${address.slice(0, 6)}...${address.slice(-4)}`;
  }, [address]);

  useEffect(() => {
    const updateCountdown = () => {
      const now = new Date();
      const nextHour = new Date(now);
      nextHour.setHours(now.getHours() + 1, 0, 0, 0);
      setMinutesRemaining(Math.max(1, Math.ceil((nextHour.getTime() - now.getTime()) / 60000)));
    };

    updateCountdown();
    const interval = window.setInterval(updateCountdown, 1000);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    let ignore = false;

    async function loadYieldRates() {
      const [mETH, USDY] = await Promise.all([fetchMethApy(), fetchUsdyApy()]);

      if (!ignore) {
        setYieldRates({ mETH, USDY });
      }
    }

    loadYieldRates().catch(() => undefined);

    return () => {
      ignore = true;
    };
  }, []);

  useEffect(() => {
    if (!publicClient || !isConnected) {
      return;
    }

    const client = publicClient;
    let ignore = false;

    async function loadHistory() {
      const latestBlock = await client.getBlockNumber();
      const fromBlock = latestBlock > historyBlockWindow ? latestBlock - historyBlockWindow : zeroBlock;
      const logs = await client.getLogs({
        address: vaultAddress,
        event: rebalanceEvent,
        fromBlock,
        toBlock: "latest",
      });

      if (ignore) {
        return;
      }

      const records = logs
        .slice(-5)
        .reverse()
        .map((log) => {
          const timestamp = Number(log.args.timestamp ?? zeroBlock) * 1000;

          return {
            id: `${log.blockNumber}-${log.transactionHash}`,
            time: timestamp ? new Date(timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "--",
            from: String(log.args.from ?? "--"),
            to: String(log.args.to ?? "--"),
            reason: String(log.args.reason ?? "--"),
          };
        });

      setHistory(records);
    }

    loadHistory().catch(() => setHistory([]));

    return () => {
      ignore = true;
    };
  }, [isConnected, publicClient]);

  function connectWallet() {
    if (typeof window.ethereum === "undefined") {
      setWalletError("MetaMask is required to connect a wallet.");
      return;
    }

    setWalletError("");
    connect({ connector: injected() });
  }

  async function handleDeposit() {
    const amount = depositAmount.trim();

    if (!amount) {
      return;
    }

    try {
      setDepositPending(true);
      setDepositSuccess("");
      const hash = await writeContractAsync({
        address: vaultAddress,
        abi: CONTRACT_ABI,
        functionName: "deposit",
        value: parseEther(amount),
        chainId: 5003,
      });

      if (publicClient) {
        await publicClient.waitForTransactionReceipt({ hash });
      }

      await queryClient.invalidateQueries();
      setDepositAmount("");
      setDepositSuccess("Deposit successful.");
    } catch (error) {
      console.error("Deposit failed:", error);
    } finally {
      setDepositPending(false);
    }
  }

  async function handleWithdraw() {
    const amount = withdrawAmount.trim();

    if (!amount) {
      return;
    }

    try {
      setWithdrawPending(true);
      setWithdrawSuccess("");
      const hash = await writeContractAsync({
        address: vaultAddress,
        abi: CONTRACT_ABI,
        functionName: "withdraw",
        args: [parseEther(amount)],
        chainId: 5003,
      });

      if (publicClient) {
        await publicClient.waitForTransactionReceipt({ hash });
      }

      await queryClient.invalidateQueries();
      setWithdrawAmount("");
      setWithdrawSuccess("Withdrawal successful.");
    } catch (error) {
      console.error("Withdraw failed:", error);
    } finally {
      setWithdrawPending(false);
    }
  }

  async function handleRebalance() {
    if (!canManualRebalance) {
      return;
    }

    try {
      setRebalancePending(true);
      setRebalanceSuccess(false);
      const hash = await writeContractAsync({
        address: vaultAddress,
        abi: CONTRACT_ABI,
        functionName: "rebalance",
        args: [nextAllocation, "Manual rebalance triggered via dashboard"],
        chainId: 5003,
      });

      if (publicClient) {
        await publicClient.waitForTransactionReceipt({ hash });
      }

      await queryClient.invalidateQueries();
      setRebalanceSuccess(true);
      window.setTimeout(() => setRebalanceSuccess(false), 2200);
    } catch (error) {
      console.error("Rebalance failed:", error);
    } finally {
      setRebalancePending(false);
    }
  }

  if (!isConnected) {
    return (
      <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-[#0a0a0f] px-6 text-white">
        <div className="absolute left-1/2 top-1/2 h-[520px] w-[520px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#00ff88]/10 blur-3xl" />
        <div className="absolute bottom-0 right-0 h-80 w-80 rounded-full bg-[#7c3aed]/20 blur-3xl" />
        <section className="relative w-full max-w-xl text-center">
          <p className="mb-4 text-xs font-semibold uppercase tracking-[0.26em] text-[#00ff88]">
            Mantle Native Yield
          </p>
          <h1 className="mb-5 bg-gradient-to-r from-white via-[#00ff88] to-[#7c3aed] bg-clip-text text-6xl font-black tracking-tight text-transparent sm:text-7xl">
            YieldMind
          </h1>
          <p className="mx-auto mb-9 max-w-md text-lg leading-8 text-slate-300">
            Let AI manage your yield. Always earning more.
          </p>
          <button
            onClick={connectWallet}
            className="w-full max-w-xs rounded-xl bg-[#00ff88] px-7 py-4 text-base font-bold text-[#07100b] shadow-[0_0_35px_rgba(0,255,136,0.35)] transition duration-300 hover:-translate-y-0.5 hover:bg-[#35ffa2]"
          >
            Connect Wallet
          </button>
          {walletError ? <p className="mt-4 text-sm text-red-300">{walletError}</p> : null}
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            {["AI Managed", "On-Chain Transparent", "Mantle Native"].map((feature) => (
              <span
                key={feature}
                className="rounded-full border border-white/10 bg-white/[0.06] px-4 py-2 text-xs font-semibold text-slate-200 shadow-xl backdrop-blur"
              >
                {feature}
              </span>
            ))}
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className="min-h-screen overflow-hidden bg-[#0a0a0f] px-5 pb-28 pt-6 text-white sm:px-8">
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(circle_at_20%_10%,rgba(0,255,136,0.13),transparent_32%),radial-gradient(circle_at_85%_20%,rgba(124,58,237,0.18),transparent_28%)]" />
      <div className="relative mx-auto max-w-7xl">
        <header className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <span className="relative flex h-3 w-3">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#00ff88] opacity-70" />
              <span className="relative inline-flex h-3 w-3 rounded-full bg-[#00ff88]" />
            </span>
            <div>
              <h1 className="text-3xl font-black tracking-tight">YieldMind</h1>
              <p className="text-xs font-medium uppercase tracking-[0.22em] text-slate-500">AI Agent Live</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <span className="rounded-full border border-white/10 bg-white/[0.06] px-4 py-2 text-sm font-medium text-slate-200 backdrop-blur">
              {shortAddress}
            </span>
            <button
              onClick={() => disconnect()}
              className="rounded-full border border-red-400/30 bg-red-500/10 px-4 py-2 text-sm font-semibold text-red-200 transition hover:border-red-300 hover:bg-red-500/20"
            >
              Disconnect
            </button>
          </div>
        </header>

        <section className="mb-6 grid gap-4 lg:grid-cols-3">
          <StatCard label="Current Allocation">
            <div className="flex items-center justify-between gap-4">
              <p key={allocation} className="text-4xl font-black transition duration-500">
                {allocation}
              </p>
              <span
                className={`rounded-full px-3 py-1 text-xs font-bold ${
                  isMeth ? "bg-[#7c3aed]/20 text-violet-200" : "bg-[#00ff88]/20 text-[#00ff88]"
                }`}
              >
                {isMeth ? "mETH" : "USDY"}
              </span>
            </div>
          </StatCard>
          <StatCard label="Your Deposit">
            <div className="flex items-end justify-between gap-4">
              <p key={String(userBalance)} className="text-4xl font-black transition duration-500">
                {formatMnt(userBalance as bigint | undefined)} <span className="text-lg text-slate-400">MNT</span>
              </p>
              <span className="mb-1 rounded-full bg-[#00ff88]/15 px-3 py-1 text-xs font-bold text-[#00ff88]">
                Upward
              </span>
            </div>
          </StatCard>
          <StatCard label="Total Vault TVL">
            <p key={String(totalDeposits)} className="text-4xl font-black transition duration-500">
              {formatMnt(totalDeposits as bigint | undefined)} <span className="text-lg text-slate-400">MNT</span>
            </p>
          </StatCard>
        </section>

        <section className="mb-6 grid gap-4 xl:grid-cols-[1.05fr_0.95fr]">
          <GlassCard className="p-6">
            <div className="mb-6 flex items-center justify-between">
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.2em] text-slate-500">Yield Comparison</p>
                <h2 className="mt-2 text-2xl font-black">mETH vs USDY APY</h2>
              </div>
              <span className="rounded-full bg-white/[0.06] px-3 py-1 text-xs font-semibold text-slate-300">
                Live
              </span>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <YieldCard
                name="mETH"
                apy={yieldRates.mETH}
                width={methWidth}
                active={allocation === "mETH"}
                color="#7c3aed"
              />
              <YieldCard
                name="USDY"
                apy={yieldRates.USDY}
                width={usdyWidth}
                active={allocation === "USDY"}
                color="#00ff88"
              />
            </div>
          </GlassCard>

          <GlassCard className="overflow-hidden p-0">
            <div className="border-b border-white/10 p-6">
              <p className="text-xs font-bold uppercase tracking-[0.2em] text-slate-500">Rebalance History</p>
              <h2 className="mt-2 text-2xl font-black">AI Decisions</h2>
            </div>
            {history.length ? (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[560px] text-left text-sm">
                  <thead className="text-xs uppercase tracking-[0.16em] text-slate-500">
                    <tr>
                      <th className="px-6 py-4 font-semibold">Time</th>
                      <th className="px-6 py-4 font-semibold">From</th>
                      <th className="px-6 py-4 font-semibold">To</th>
                      <th className="px-6 py-4 font-semibold">Reason</th>
                    </tr>
                  </thead>
                  <tbody>
                    {history.map((record) => (
                      <tr key={record.id} className="border-t border-white/10 text-slate-300">
                        <td className="px-6 py-4">{record.time}</td>
                        <td className="px-6 py-4">{record.from}</td>
                        <td className="px-6 py-4 text-[#00ff88]">{record.to}</td>
                        <td className="px-6 py-4">{record.reason}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="flex min-h-56 items-center justify-center px-6 text-center">
                <p className="text-sm text-slate-400">AI agent has not rebalanced yet</p>
              </div>
            )}
          </GlassCard>
        </section>

        <GlassCard className="mb-6 p-6">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.2em] text-slate-500">Manual Rebalance</p>
              <h2 className="mt-2 text-2xl font-black">Switch Allocation</h2>
              <p className="mt-2 text-sm text-slate-400">
                Switches allocation between mETH and USDY — AI agent does this automatically every hour
              </p>
            </div>
            <button
              onClick={handleRebalance}
              disabled={rebalancePending || !canManualRebalance}
              className="inline-flex min-h-14 items-center justify-center gap-3 rounded-xl bg-[#7c3aed] px-7 py-4 text-base font-black text-white shadow-[0_0_34px_rgba(124,58,237,0.32)] transition duration-300 hover:-translate-y-0.5 hover:bg-violet-500 disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:translate-y-0"
            >
              {rebalancePending ? (
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
              ) : null}
              {rebalancePending ? "Processing..." : rebalanceSuccess ? "Rebalanced!" : "Trigger Rebalance"}
            </button>
          </div>
        </GlassCard>

        <section className="grid gap-4 lg:grid-cols-2">
          <ActionPanel
            title="Deposit"
            balanceLabel={`Wallet balance ${formatMnt(walletBalance?.value)} MNT`}
            amount={depositAmount}
            onAmountChange={setDepositAmount}
            onSubmit={handleDeposit}
            buttonLabel={depositPending ? "Processing..." : "Deposit"}
            buttonClassName="bg-[#00ff88] text-[#07100b] shadow-[0_0_28px_rgba(0,255,136,0.22)] hover:bg-[#35ffa2]"
            disabled={depositPending}
            successMessage={depositSuccess}
          />
          <ActionPanel
            title="Withdraw"
            balanceLabel={`Vault balance ${formatMnt(userBalance as bigint | undefined)} MNT`}
            amount={withdrawAmount}
            onAmountChange={setWithdrawAmount}
            onSubmit={handleWithdraw}
            buttonLabel={withdrawPending ? "Processing..." : "Withdraw"}
            buttonClassName="bg-red-500 text-white shadow-[0_0_28px_rgba(239,68,68,0.18)] hover:bg-red-400"
            disabled={withdrawPending}
            successMessage={withdrawSuccess}
          />
        </section>
      </div>

      <div className="fixed inset-x-0 bottom-0 z-20 border-t border-white/10 bg-[#0a0a0f]/80 px-5 py-4 backdrop-blur-xl">
        <div className="mx-auto flex max-w-7xl items-center gap-3 text-sm font-medium text-slate-200">
          <span className="relative flex h-3 w-3 shrink-0">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#00ff88] opacity-70" />
            <span className="relative inline-flex h-3 w-3 rounded-full bg-[#00ff88]" />
          </span>
          <span>AI Agent Active — Next yield check in {minutesRemaining} minutes</span>
        </div>
      </div>
    </main>
  );
}

function GlassCard({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={`rounded-2xl border border-white/10 bg-white/[0.055] shadow-2xl shadow-black/30 backdrop-blur-xl ${className}`}
    >
      {children}
    </div>
  );
}

function StatCard({ label, children }: { label: string; children: ReactNode }) {
  return (
    <GlassCard className="p-6 transition duration-300 hover:-translate-y-1 hover:border-[#00ff88]/30">
      <p className="mb-4 text-xs font-bold uppercase tracking-[0.2em] text-slate-500">{label}</p>
      {children}
    </GlassCard>
  );
}

function YieldCard({
  name,
  apy,
  width,
  active,
  color,
}: {
  name: string;
  apy: number;
  width: string;
  active: boolean;
  color: string;
}) {
  return (
    <div
      className={`rounded-2xl border bg-black/20 p-5 transition duration-500 ${
        active ? "border-white/30 shadow-[0_0_36px_rgba(0,255,136,0.18)]" : "border-white/10"
      }`}
    >
      <div className="mb-4 flex items-center justify-between">
        <div>
          <p className="text-sm font-bold">{name}</p>
          <p className="text-xs text-slate-500">{active ? "Active allocation" : "Available strategy"}</p>
        </div>
        <p className="text-3xl font-black" style={{ color }}>
          {formatPercent(apy)}
        </p>
      </div>
      <div className="h-3 overflow-hidden rounded-full bg-white/10">
        <div
          className="h-full rounded-full transition-all duration-700"
          style={{
            width,
            backgroundColor: color,
            boxShadow: `0 0 22px ${color}`,
          }}
        />
      </div>
    </div>
  );
}

function ActionPanel({
  title,
  balanceLabel,
  amount,
  onAmountChange,
  onSubmit,
  buttonLabel,
  buttonClassName,
  disabled = false,
  successMessage = "",
}: {
  title: string;
  balanceLabel: string;
  amount: string;
  onAmountChange: (amount: string) => void;
  onSubmit: () => Promise<void>;
  buttonLabel: string;
  buttonClassName: string;
  disabled?: boolean;
  successMessage?: string;
}) {
  return (
    <GlassCard className="p-6">
      <div className="mb-5 flex items-start justify-between">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-slate-500">{title}</p>
          <h2 className="mt-2 text-2xl font-black">{title} MNT</h2>
        </div>
        <p className="rounded-full bg-white/[0.06] px-3 py-1 text-xs font-semibold text-slate-300">{balanceLabel}</p>
      </div>
      <div className="relative mb-4">
        <input
          type="number"
          min="0"
          step="0.0001"
          inputMode="decimal"
          placeholder="0.0000"
          value={amount}
          onChange={(event) => onAmountChange(event.target.value)}
          className="w-full rounded-xl border border-white/10 bg-black/30 px-4 py-4 pr-16 text-lg font-semibold text-white outline-none transition placeholder:text-slate-600 focus:border-[#00ff88]/70 focus:bg-black/40"
        />
        <span className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-sm font-bold text-slate-400">
          MNT
        </span>
      </div>
      <button
        onClick={onSubmit}
        disabled={disabled}
        className={`w-full rounded-xl px-5 py-4 text-base font-black transition duration-300 hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:translate-y-0 ${buttonClassName}`}
      >
        {buttonLabel}
      </button>
      {successMessage ? <p className="mt-3 text-sm font-semibold text-[#00ff88]">{successMessage}</p> : null}
    </GlassCard>
  );
}

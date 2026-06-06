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
  timestamp: number;
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

function mntNumber(value?: bigint) {
  if (!value) {
    return 0;
  }

  return Number(formatEther(value));
}

function formatPercent(value: number) {
  return `${value.toFixed(2)}%`;
}

function formatTimer(totalSeconds: number) {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

function timeAgo(timestamp: number) {
  const seconds = Math.max(1, Math.floor((Date.now() - timestamp) / 1000));

  if (seconds < 60) {
    return `${seconds}s ago`;
  }

  const minutes = Math.floor(seconds / 60);

  if (minutes < 60) {
    return `${minutes}m ago`;
  }

  const hours = Math.floor(minutes / 60);
  return `${hours}h ago`;
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
  const [secondsRemaining, setSecondsRemaining] = useState(3600);
  const [history, setHistory] = useState<RebalanceRecord[]>([]);
  const [yieldRates, setYieldRates] = useState<YieldRates>(fallbackYieldRates);
  const [depositPending, setDepositPending] = useState(false);
  const [withdrawPending, setWithdrawPending] = useState(false);
  const [rebalancePending, setRebalancePending] = useState(false);
  const [depositSuccess, setDepositSuccess] = useState(false);
  const [withdrawSuccess, setWithdrawSuccess] = useState(false);
  const [rebalanceSuccess, setRebalanceSuccess] = useState(false);

  const publicClient = usePublicClient();
  const queryClient = useQueryClient();
  const { address, isConnected } = useAccount();
  const { connect } = useConnect();
  const { disconnect } = useDisconnect();
  const { writeContractAsync } = useWriteContract();

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

  const allocation = currentAllocation?.toString();
  const displayAllocation = allocation ?? "Loading";
  const isMeth = allocation === "mETH";
  const canManualRebalance = allocation === "USDY" || allocation === "mETH";
  const nextAllocation = allocation === "USDY" ? "mETH" : "USDY";
  const winningAsset = yieldRates.mETH >= yieldRates.USDY ? "mETH" : "USDY";
  const maxYield = Math.max(yieldRates.mETH, yieldRates.USDY, 1);
  const methWidth = `${Math.max(8, (yieldRates.mETH / maxYield) * 100)}%`;
  const usdyWidth = `${Math.max(8, (yieldRates.USDY / maxYield) * 100)}%`;

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
      setSecondsRemaining(Math.max(1, Math.ceil((nextHour.getTime() - now.getTime()) / 1000)));
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
            timestamp,
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
      setDepositSuccess(false);
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
      setDepositSuccess(true);
      window.setTimeout(() => setDepositSuccess(false), 1800);
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
      setWithdrawSuccess(false);
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
      setWithdrawSuccess(true);
      window.setTimeout(() => setWithdrawSuccess(false), 1800);
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
      window.setTimeout(() => setRebalanceSuccess(false), 1800);
    } catch (error) {
      console.error("Rebalance failed:", error);
    } finally {
      setRebalancePending(false);
    }
  }

  if (!isConnected) {
    return (
      <main className="relative flex min-h-screen overflow-hidden bg-black px-6 text-white">
        <AmbientBackground />
        <section className="relative z-10 mx-auto flex w-full max-w-4xl flex-col items-center justify-center text-center">
          <div className="animate-fade-in [animation-delay:120ms] [animation-fill-mode:both]">
            <h1 className="logo-shimmer text-6xl font-black sm:text-8xl">YieldMind</h1>
            <p className="mt-6 text-base leading-7 text-[#6b7280] sm:text-xl">
              Autonomous yield optimization. Powered by AI. Built on Mantle.
            </p>
          </div>
          <button
            onClick={connectWallet}
            className="glow-pulse mt-10 rounded-2xl bg-[#00ff88] px-9 py-4 text-base font-black text-black transition duration-300 hover:scale-[1.02] hover:shadow-[0_0_42px_rgba(0,255,136,0.55)]"
          >
            Connect Wallet
          </button>
          {walletError ? <p className="mt-4 text-sm text-red-300">{walletError}</p> : null}
          <div className="mt-8 grid w-full max-w-2xl gap-3 sm:grid-cols-3">
            <FeaturePill icon="AI" label="AI Managed" />
            <FeaturePill icon="OC" label="On-Chain Transparent" />
            <FeaturePill icon="MN" label="Mantle Native" />
          </div>
        </section>
        <p className="absolute bottom-8 left-1/2 z-10 -translate-x-1/2 text-xs font-semibold uppercase text-[#6b7280]">
          Powered by Mantle Network
        </p>
        <GlobalStyles />
      </main>
    );
  }

  return (
    <main className="relative min-h-screen overflow-hidden bg-black px-4 pb-20 pt-4 text-white sm:px-6">
      <AmbientBackground />
      <div className="relative z-10 mx-auto flex min-h-[calc(100vh-6rem)] max-w-7xl flex-col gap-4">
        <nav className="animate-fade-in flex items-center justify-between opacity-0 [animation-delay:60ms] [animation-fill-mode:forwards]">
          <div className="flex items-center gap-3">
            <PulseDot />
            <div>
              <h1 className="text-2xl font-black">YieldMind</h1>
              <p className="text-[10px] font-bold uppercase text-[#6b7280]">AI Yield Terminal</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="rounded-full border border-white/10 bg-white/[0.05] px-4 py-2 text-xs font-semibold text-gray-200 backdrop-blur-xl">
              {shortAddress}
            </span>
            <button
              onClick={() => disconnect()}
              className="rounded-full border border-red-400/45 bg-red-500/10 px-4 py-2 text-xs font-bold text-red-200 transition duration-300 hover:scale-[1.02] hover:border-red-300 hover:bg-red-500/20 hover:text-red-100"
            >
              Disconnect
            </button>
          </div>
        </nav>

        <div className="line-sweep h-px w-full bg-white/10" />

        <section className="grid gap-3 lg:grid-cols-4">
          <TerminalCard delay="120ms">
            <CardLabel>Current Allocation</CardLabel>
            <div className="mt-4 flex items-center justify-between">
              {allocation ? (
                <span
                  className={`rounded-2xl px-4 py-3 text-3xl font-black ${
                    isMeth
                      ? "bg-[#7c3aed]/20 text-violet-200 shadow-[0_0_30px_rgba(124,58,237,0.25)]"
                      : "bg-[#00ff88]/15 text-[#00ff88] shadow-[0_0_30px_rgba(0,255,136,0.18)]"
                  }`}
                >
                  {displayAllocation}
                </span>
              ) : (
                <Skeleton className="h-14 w-32 rounded-2xl" />
              )}
              <span className="text-xs font-bold uppercase text-[#6b7280]">AI Managed</span>
            </div>
          </TerminalCard>

          <TerminalCard delay="180ms">
            <CardLabel>Your Deposit</CardLabel>
            <div className="mt-4 flex items-end justify-between">
              <MetricNumber value={mntNumber(userBalance as bigint | undefined)} suffix=" MNT" />
              <span className="text-2xl font-black text-[#00ff88]">↗</span>
            </div>
          </TerminalCard>

          <TerminalCard delay="240ms">
            <CardLabel>Total Vault TVL</CardLabel>
            <div className="mt-4">
              <MetricNumber value={mntNumber(totalDeposits as bigint | undefined)} suffix=" MNT" />
            </div>
          </TerminalCard>

          <TerminalCard delay="300ms">
            <CardLabel>Agent Status</CardLabel>
            <div className="mt-4 flex items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <PulseDot />
                <div>
                  <p className="text-2xl font-black text-[#00ff88]">Active</p>
                  <p className="text-xs text-[#6b7280]">Next check {formatTimer(secondsRemaining)}</p>
                </div>
              </div>
            </div>
          </TerminalCard>
        </section>

        <section className="grid min-h-0 flex-1 gap-4 xl:grid-cols-[1.05fr_0.95fr]">
          <TerminalCard className="min-h-[310px]" delay="360ms">
            <div className="mb-5 flex items-start justify-between">
              <div>
                <CardLabel>Yield Battle</CardLabel>
                <h2 className="mt-1 text-2xl font-black">mETH vs USDY</h2>
              </div>
              <span className="flex items-center gap-2 rounded-full border border-red-400/20 bg-red-500/10 px-3 py-1 text-xs font-black text-red-200">
                <span className="h-2 w-2 animate-pulse rounded-full bg-red-400" />
                LIVE
              </span>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <YieldBattlePanel
                name="mETH"
                apy={yieldRates.mETH}
                width={methWidth}
                winning={winningAsset === "mETH"}
                color="#7c3aed"
              />
              <YieldBattlePanel
                name="USDY"
                apy={yieldRates.USDY}
                width={usdyWidth}
                winning={winningAsset === "USDY"}
                color="#00ff88"
              />
            </div>
          </TerminalCard>

          <TerminalCard className="min-h-[310px] overflow-hidden" delay="420ms">
            <div className="mb-5 flex items-start justify-between">
              <div>
                <CardLabel>AI Decisions</CardLabel>
                <h2 className="mt-1 text-2xl font-black">Decision Log</h2>
              </div>
              <span className="rounded-full border border-white/10 px-3 py-1 text-xs font-bold text-[#6b7280]">
                Last 5
              </span>
            </div>
            {history.length ? (
              <div className="max-h-[230px] space-y-3 overflow-y-auto pr-2">
                {history.map((record) => (
                  <div key={record.id} className="rounded-2xl border border-white/10 bg-black/30 p-4">
                    <div className="mb-2 flex items-center justify-between gap-3">
                      <span className="text-xs font-bold uppercase text-[#6b7280]">
                        {record.timestamp ? timeAgo(record.timestamp) : "Just now"}
                      </span>
                      <span className="text-sm font-black text-white">
                        {record.from} <span className="text-[#00ff88]">→</span> {record.to}
                      </span>
                    </div>
                    <p className="text-sm leading-5 text-gray-400">{record.reason}</p>
                  </div>
                ))}
              </div>
            ) : (
              <div className="flex min-h-[220px] flex-col items-center justify-center text-center">
                <div className="mb-4 grid h-14 w-14 place-items-center rounded-2xl border border-white/10 bg-white/[0.04]">
                  <span className="h-5 w-5 animate-ping rounded-full bg-[#00ff88]/60" />
                </div>
                <p className="text-sm text-[#6b7280]">AI agent is monitoring yields...</p>
              </div>
            )}
          </TerminalCard>
        </section>

        <section className="grid gap-4 lg:grid-cols-3">
          <ActionCard
            title="Deposit"
            balanceLabel={`Wallet balance ${formatMnt(walletBalance?.value)} MNT`}
            amount={depositAmount}
            onAmountChange={setDepositAmount}
            onSubmit={handleDeposit}
            pending={depositPending}
            success={depositSuccess}
            idleLabel="Deposit"
            pendingLabel="Processing..."
            successLabel="✓ Deposited"
            buttonClassName="bg-[#00ff88] text-black shadow-[0_0_26px_rgba(0,255,136,0.24)] hover:shadow-[0_0_38px_rgba(0,255,136,0.42)]"
          />

          <ActionCard
            title="Withdraw"
            balanceLabel={`Vault balance ${formatMnt(userBalance as bigint | undefined)} MNT`}
            amount={withdrawAmount}
            onAmountChange={setWithdrawAmount}
            onSubmit={handleWithdraw}
            pending={withdrawPending}
            success={withdrawSuccess}
            idleLabel="Withdraw"
            pendingLabel="Processing..."
            successLabel="✓ Withdrawn"
            buttonClassName="bg-red-500 text-white shadow-[0_0_26px_rgba(239,68,68,0.2)] hover:shadow-[0_0_38px_rgba(239,68,68,0.38)]"
          />

          <TerminalCard delay="600ms">
            <CardLabel>Manual Override</CardLabel>
            <h2 className="mt-2 text-2xl font-black">Rebalance Card</h2>
            <div className="my-5 rounded-2xl border border-white/10 bg-black/30 p-4">
              <p className="text-xs font-bold uppercase text-[#6b7280]">Current Allocation</p>
              {allocation ? (
                <p className={`mt-2 text-3xl font-black ${isMeth ? "text-violet-300" : "text-[#00ff88]"}`}>
                  {displayAllocation}
                </p>
              ) : (
                <Skeleton className="mt-3 h-10 w-28 rounded-xl" />
              )}
            </div>
            <button
              onClick={handleRebalance}
              disabled={rebalancePending || !canManualRebalance}
              className={`flex w-full items-center justify-center gap-3 rounded-2xl px-5 py-4 text-base font-black transition duration-300 hover:scale-[1.02] disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:scale-100 ${
                rebalanceSuccess
                  ? "bg-white text-black"
                  : "bg-[#7c3aed] text-white shadow-[0_0_28px_rgba(124,58,237,0.35)] hover:shadow-[0_0_42px_rgba(124,58,237,0.55)]"
              }`}
            >
              {rebalancePending ? <Spinner /> : null}
              {rebalancePending ? "Processing..." : rebalanceSuccess ? "✓ Rebalanced" : "Trigger Rebalance"}
            </button>
            <p className="mt-3 text-xs leading-5 text-[#6b7280]">AI rebalances automatically. This is manual override.</p>
          </TerminalCard>
        </section>
      </div>

      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-white/10 bg-black/70 px-4 py-3 backdrop-blur-xl">
        <div className="mx-auto grid max-w-7xl items-center gap-2 text-xs font-bold text-gray-300 sm:grid-cols-3">
          <div className="flex items-center gap-3">
            <PulseDot />
            <span>AI Agent Active</span>
          </div>
          <div className="text-left text-[#00ff88] sm:text-center">Next yield check in {formatTimer(secondsRemaining)}</div>
          <div className="text-left text-[#6b7280] sm:text-right">
            Built on <span className="text-[#00ff88]">Mantle Network</span>
          </div>
        </div>
      </div>
      <GlobalStyles />
    </main>
  );
}

function AmbientBackground() {
  return (
    <>
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.035)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.035)_1px,transparent_1px)] bg-[size:44px_44px]" />
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_20%_18%,rgba(0,255,136,0.12),transparent_30%),radial-gradient(circle_at_78%_12%,rgba(124,58,237,0.16),transparent_28%),radial-gradient(circle_at_50%_95%,rgba(0,255,136,0.06),transparent_28%)]" />
      <div className="particle particle-a" />
      <div className="particle particle-b" />
      <div className="particle particle-c" />
      <div className="particle particle-d" />
    </>
  );
}

function FeaturePill({ icon, label }: { icon: string; label: string }) {
  return (
    <div className="animate-fade-in rounded-2xl border border-white/10 bg-white/[0.045] p-4 shadow-2xl backdrop-blur-xl [animation-delay:360ms] [animation-fill-mode:both]">
      <div className="mx-auto mb-3 grid h-9 w-9 place-items-center rounded-full border border-[#00ff88]/25 bg-[#00ff88]/10 text-[10px] font-black text-[#00ff88]">
        {icon}
      </div>
      <p className="text-sm font-bold text-white">{label}</p>
    </div>
  );
}

function TerminalCard({ children, className = "", delay = "0ms" }: { children: ReactNode; className?: string; delay?: string }) {
  return (
    <div
      className={`animate-fade-in rounded-3xl border border-white/10 bg-white/[0.045] p-5 opacity-0 shadow-2xl shadow-black/40 backdrop-blur-xl transition duration-300 hover:border-white/20 ${className}`}
      style={{ animationDelay: delay, animationFillMode: "forwards" }}
    >
      {children}
    </div>
  );
}

function CardLabel({ children }: { children: ReactNode }) {
  return <p className="text-[10px] font-black uppercase text-[#6b7280]">{children}</p>;
}

function PulseDot() {
  return (
    <span className="relative flex h-3 w-3 shrink-0">
      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#00ff88] opacity-70" />
      <span className="relative inline-flex h-3 w-3 rounded-full bg-[#00ff88]" />
    </span>
  );
}

function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`skeleton bg-white/[0.06] ${className}`} />;
}

function Spinner() {
  return <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />;
}

function MetricNumber({ value, suffix }: { value: number; suffix: string }) {
  const [displayValue, setDisplayValue] = useState(0);

  useEffect(() => {
    let frame = 0;
    const start = performance.now();
    const duration = 850;

    function tick(now: number) {
      const progress = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - progress, 3);
      setDisplayValue(value * eased);

      if (progress < 1) {
        frame = requestAnimationFrame(tick);
      }
    }

    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [value]);

  return (
    <p className="text-3xl font-black text-white">
      {displayValue.toFixed(4)}
      <span className="ml-1 text-sm font-bold text-[#6b7280]">{suffix}</span>
    </p>
  );
}

function YieldBattlePanel({
  name,
  apy,
  width,
  winning,
  color,
}: {
  name: string;
  apy: number;
  width: string;
  winning: boolean;
  color: string;
}) {
  return (
    <div
      className={`rounded-3xl border bg-black/35 p-5 transition duration-300 hover:scale-[1.02] ${
        winning ? "border-white/25 shadow-[0_0_34px_rgba(0,255,136,0.18)]" : "border-white/10"
      }`}
    >
      <div className="mb-5 flex items-center justify-between gap-3">
        <p className="text-lg font-black">{name}</p>
        {winning ? (
          <span className="rounded-full bg-[#00ff88]/15 px-3 py-1 text-[10px] font-black text-[#00ff88]">WINNING</span>
        ) : null}
      </div>
      <p className="mb-5 text-5xl font-black" style={{ color }}>
        {formatPercent(apy)}
      </p>
      <div className="h-2 overflow-hidden rounded-full bg-white/10">
        <div
          className="yield-bar h-full rounded-full"
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

function ActionCard({
  title,
  balanceLabel,
  amount,
  onAmountChange,
  onSubmit,
  pending,
  success,
  idleLabel,
  pendingLabel,
  successLabel,
  buttonClassName,
}: {
  title: string;
  balanceLabel: string;
  amount: string;
  onAmountChange: (amount: string) => void;
  onSubmit: () => Promise<void>;
  pending: boolean;
  success: boolean;
  idleLabel: string;
  pendingLabel: string;
  successLabel: string;
  buttonClassName: string;
}) {
  return (
    <TerminalCard delay={title === "Deposit" ? "480ms" : "540ms"}>
      <CardLabel>{title}</CardLabel>
      <div className="mt-2 flex items-center justify-between">
        <h2 className="text-2xl font-black">{title} MNT</h2>
        <span className="text-xs font-semibold text-[#6b7280]">{balanceLabel}</span>
      </div>
      <div className="relative my-5">
        <input
          type="number"
          min="0"
          step="0.0001"
          inputMode="decimal"
          placeholder="0.0000"
          value={amount}
          onChange={(event) => onAmountChange(event.target.value)}
          className="w-full rounded-2xl border border-white/10 bg-black/45 px-4 py-4 pr-16 text-lg font-black text-white outline-none transition duration-300 placeholder:text-[#6b7280] focus:border-[#00ff88]/60"
        />
        <span className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-sm font-black text-[#6b7280]">
          MNT
        </span>
      </div>
      <button
        onClick={onSubmit}
        disabled={pending}
        className={`flex w-full items-center justify-center gap-3 rounded-2xl px-5 py-4 text-base font-black transition duration-300 hover:scale-[1.02] disabled:cursor-not-allowed disabled:opacity-70 disabled:hover:scale-100 ${
          success ? "bg-white text-black shadow-[0_0_34px_rgba(255,255,255,0.24)]" : buttonClassName
        }`}
      >
        {pending ? <Spinner /> : null}
        {pending ? pendingLabel : success ? successLabel : idleLabel}
      </button>
    </TerminalCard>
  );
}

function GlobalStyles() {
  return (
    <style jsx global>{`
      @keyframes fadeIn {
        from {
          opacity: 0;
          transform: translateY(14px);
        }
        to {
          opacity: 1;
          transform: translateY(0);
        }
      }

      @keyframes shimmerText {
        0% {
          background-position: -220% center;
        }
        100% {
          background-position: 220% center;
        }
      }

      @keyframes glowPulse {
        0%,
        100% {
          box-shadow: 0 0 24px rgba(0, 255, 136, 0.28);
        }
        50% {
          box-shadow: 0 0 52px rgba(0, 255, 136, 0.52);
        }
      }

      @keyframes lineSweep {
        from {
          transform: scaleX(0);
          transform-origin: left;
        }
        to {
          transform: scaleX(1);
          transform-origin: left;
        }
      }

      @keyframes floatParticle {
        0% {
          transform: translate3d(0, 0, 0);
          opacity: 0.18;
        }
        50% {
          transform: translate3d(38px, -42px, 0);
          opacity: 0.5;
        }
        100% {
          transform: translate3d(0, 0, 0);
          opacity: 0.18;
        }
      }

      @keyframes skeletonShimmer {
        from {
          background-position: -220% 0;
        }
        to {
          background-position: 220% 0;
        }
      }

      @keyframes yieldFill {
        from {
          transform: scaleX(0);
          transform-origin: left;
        }
        to {
          transform: scaleX(1);
          transform-origin: left;
        }
      }

      .animate-fade-in {
        animation: fadeIn 720ms cubic-bezier(0.22, 1, 0.36, 1);
      }

      .logo-shimmer {
        background: linear-gradient(90deg, #ffffff 0%, #ffffff 34%, #00ff88 50%, #ffffff 66%, #ffffff 100%);
        background-size: 220% auto;
        -webkit-background-clip: text;
        background-clip: text;
        color: transparent;
        animation: shimmerText 3.6s linear infinite;
      }

      .glow-pulse {
        animation: glowPulse 2.5s ease-in-out infinite;
      }

      .line-sweep {
        background: linear-gradient(90deg, transparent, #00ff88, transparent);
        animation: lineSweep 1.15s ease-out forwards;
      }

      .particle {
        pointer-events: none;
        position: absolute;
        height: 5px;
        width: 5px;
        border-radius: 9999px;
        background: #00ff88;
        box-shadow: 0 0 22px rgba(0, 255, 136, 0.72);
        animation: floatParticle 8s ease-in-out infinite;
      }

      .particle-a {
        left: 12%;
        top: 20%;
      }

      .particle-b {
        left: 72%;
        top: 16%;
        animation-delay: 1.2s;
        background: #7c3aed;
        box-shadow: 0 0 22px rgba(124, 58, 237, 0.72);
      }

      .particle-c {
        left: 82%;
        top: 64%;
        animation-delay: 2.3s;
      }

      .particle-d {
        left: 22%;
        top: 76%;
        animation-delay: 3.1s;
        background: #7c3aed;
        box-shadow: 0 0 22px rgba(124, 58, 237, 0.72);
      }

      .skeleton {
        background-image: linear-gradient(90deg, rgba(255, 255, 255, 0.04), rgba(255, 255, 255, 0.14), rgba(255, 255, 255, 0.04));
        background-size: 220% 100%;
        animation: skeletonShimmer 1.5s linear infinite;
      }

      .yield-bar {
        animation: yieldFill 900ms cubic-bezier(0.22, 1, 0.36, 1) forwards;
      }
    `}</style>
  );
}

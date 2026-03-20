import { useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import { WalletButton } from "./components/WalletButton";
import { DevModeNotice } from "./components/DevModeNotice";
import { ProposalCard } from "./components/ProposalCard";
import { AdminPanel } from "./panels/AdminPanel";
import { VoterPanel } from "./panels/VoterPanel";
import { ResultsView } from "./panels/ResultsView";
import { useProposal } from "./hooks/useProposal";

type Tab = "admin" | "voter" | "results";

const TABS: { id: Tab; label: string }[] = [
  { id: "admin",   label: "Admin" },
  { id: "voter",   label: "Vote" },
  { id: "results", label: "Results" },
];

export default function App() {
  const { publicKey } = useWallet();
  const [tab, setTab] = useState<Tab>("voter");

  // The active proposal PDA — set after the admin creates one.
  // In a production app you'd enumerate all proposals; here we store the single
  // known PDA (derived from admin + title or passed via URL param).
  const [proposalPda, setProposalPda] = useState<PublicKey | null>(() => {
    const saved = localStorage.getItem("proposalPda");
    return saved ? new PublicKey(saved) : null;
  });

  const { proposal, loading, refresh } = useProposal(proposalPda);

  function handleProposalCreated(pda: PublicKey) {
    setProposalPda(pda);
    localStorage.setItem("proposalPda", pda.toBase58());
  }

  // If the connected wallet is the proposal admin, default to the admin tab.
  const isAdmin = publicKey && proposal
    ? proposal.admin.toBase58() === publicKey.toBase58()
    : false;

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Header */}
      <header className="bg-white border-b border-slate-200 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="text-2xl">🗳️</span>
          <div>
            <h1 className="text-lg font-bold text-slate-900 leading-none">Solana Ballot</h1>
            <p className="text-xs text-slate-400">ZK-powered private voting</p>
          </div>
        </div>
        <WalletButton />
      </header>

      <main className="max-w-2xl mx-auto px-4 py-6 space-y-4">
        <DevModeNotice />

        {/* Proposal card */}
        {loading && !proposal && (
          <div className="text-center text-slate-400 py-8">Loading proposal…</div>
        )}
        {proposal && <ProposalCard proposal={proposal} />}
        {!proposal && !loading && (
          <div className="bg-white rounded-xl border border-slate-200 p-6 text-center text-slate-400">
            No active proposal.{isAdmin || !publicKey ? "" : " Connect as admin to create one."}
          </div>
        )}

        {/* Tab bar */}
        <div className="flex border-b border-slate-200 bg-white rounded-t-xl overflow-hidden">
          {TABS.map(t => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`flex-1 py-3 text-sm font-medium transition-colors ${
                tab === t.id
                  ? "text-indigo-600 border-b-2 border-indigo-600 bg-indigo-50"
                  : "text-slate-500 hover:text-slate-700"
              }`}
            >
              {t.label}
              {t.id === "admin" && isAdmin && (
                <span className="ml-1.5 text-xs bg-indigo-100 text-indigo-600 px-1.5 py-0.5 rounded-full">
                  you
                </span>
              )}
            </button>
          ))}
        </div>

        {/* Tab content */}
        <div>
          {tab === "admin" && (
            <AdminPanel
              proposal={proposal}
              proposalPda={proposalPda}
              onRefresh={refresh}
              onProposalCreated={handleProposalCreated}
            />
          )}
          {tab === "voter" && (
            <VoterPanel
              proposal={proposal}
              proposalPda={proposalPda}
              onRefresh={refresh}
            />
          )}
          {tab === "results" && <ResultsView proposal={proposal} />}
        </div>
      </main>
    </div>
  );
}

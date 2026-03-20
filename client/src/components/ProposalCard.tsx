import { StatusBadge } from "./StatusBadge";
import type { ProposalAccount } from "../hooks/useProposal";

function fmtTime(ts: { toNumber(): number }): string {
  return new Date(ts.toNumber() * 1000).toLocaleString();
}

export function ProposalCard({ proposal }: { proposal: ProposalAccount }) {
  return (
    <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6 text-left">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold text-slate-900">
            {proposal.title}
          </h2>
          <p className="text-slate-500 mt-1">{proposal.description}</p>
        </div>
        <StatusBadge status={proposal.status} />
      </div>

      <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
        <Stat label="Registered voters" value={proposal.voterCount.toNumber()} />
        <Stat label="Votes cast"        value={proposal.voteCount.toNumber()} />
        <Stat label="Voting opens"      value={fmtTime(proposal.votingStart)} />
        <Stat label="Voting closes"     value={fmtTime(proposal.votingEnd)} />
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="bg-slate-50 rounded-lg p-3">
      <p className="text-xs text-slate-400 uppercase tracking-wide">{label}</p>
      <p className="font-semibold text-slate-800 mt-0.5">{value}</p>
    </div>
  );
}

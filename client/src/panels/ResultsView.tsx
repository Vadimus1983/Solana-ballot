import type { ProposalAccount } from "../hooks/useProposal";

export function ResultsView({ proposal }: { proposal: ProposalAccount | null }) {
  if (!proposal) return <p className="text-slate-500">No active proposal.</p>;

  const status = Object.keys(proposal.status)[0];
  if (status !== "finalized") {
    return (
      <div className="bg-slate-50 border border-slate-200 rounded-xl p-6 text-slate-600">
        Results will be available once the tally is finalized.
      </div>
    );
  }

  const yes   = proposal.yesCount.toNumber() as number;
  const no    = proposal.noCount.toNumber()  as number;
  const total = yes + no;
  const yesPct = total > 0 ? Math.round((yes / total) * 100) : 0;
  const noPct  = 100 - yesPct;
  const winner = yes > no ? "YES" : no > yes ? "NO" : "TIE";

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-6 space-y-5">
      <h3 className="font-semibold text-slate-800">Final Results</h3>

      <Bar label="YES ✓" count={yes} pct={yesPct} color="bg-green-500" />
      <Bar label="NO ✗"  count={no}  pct={noPct}  color="bg-red-500"   />

      <div className="flex gap-6 text-sm text-slate-500 pt-2 border-t border-slate-100">
        <span>Total votes revealed: <strong className="text-slate-800">{total}</strong></span>
        <span>Registered voters: <strong className="text-slate-800">{proposal.voterCount.toNumber()}</strong></span>
      </div>

      <div className={`rounded-lg px-4 py-3 text-center font-bold text-lg ${
        winner === "YES" ? "bg-green-50 text-green-700" :
        winner === "NO"  ? "bg-red-50 text-red-700"     :
        "bg-slate-50 text-slate-700"
      }`}>
        {winner === "TIE" ? "Result: TIE" : `Winner: ${winner}`}
      </div>
    </div>
  );
}

function Bar({ label, count, pct, color }: {
  label: string; count: number; pct: number; color: string;
}) {
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-sm">
        <span className="font-medium text-slate-700">{label}</span>
        <span className="text-slate-500">{count} votes ({pct}%)</span>
      </div>
      <div className="w-full bg-slate-100 rounded-full h-4 overflow-hidden">
        <div
          className={`${color} h-4 rounded-full transition-all duration-500`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

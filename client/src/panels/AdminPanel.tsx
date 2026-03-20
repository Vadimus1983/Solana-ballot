import { useState } from "react";
import { BN } from "@coral-xyz/anchor";
import { useWallet } from "@solana/wallet-adapter-react";
import { useProgram } from "../hooks/useProgram";
import { TxButton } from "../components/TxButton";
import { getProposalPda } from "../lib/pda";
import type { ProposalAccount } from "../hooks/useProposal";
import type { PublicKey } from "@solana/web3.js";

interface Props {
  proposal: ProposalAccount | null;
  proposalPda: PublicKey | null;
  onRefresh: () => void;
  onProposalCreated: (pda: PublicKey) => void;
}

export function AdminPanel({ proposal, proposalPda, onRefresh, onProposalCreated }: Props) {
  const program = useProgram();
  const { publicKey } = useWallet();

  if (!publicKey) return <p className="text-slate-500">Connect your wallet to use the admin panel.</p>;
  if (!program)   return null;

  const isAdmin = proposal
    ? proposal.admin.toBase58() === publicKey.toBase58()
    : true; // no proposal yet — anyone can create

  if (proposal && !isAdmin) {
    return <p className="text-slate-500">You are not the admin of this proposal.</p>;
  }

  const status = proposal ? Object.keys(proposal.status)[0] : null;

  return (
    <div className="space-y-6">
      {!proposal && (
        <CreateProposalForm
          program={program}
          admin={publicKey}
          onCreated={onProposalCreated}
          onRefresh={onRefresh}
        />
      )}

      {proposal && status === "registration" && (
        <RegisterVoterForm program={program} proposalPda={proposalPda!} onRefresh={onRefresh} />
      )}

      {proposal && (
        <LifecycleControls
          program={program}
          proposalPda={proposalPda!}
          status={status!}
          voterCount={proposal.voterCount.toNumber()}
          onRefresh={onRefresh}
        />
      )}
    </div>
  );
}

// ── Create Proposal ───────────────────────────────────────────────────────────

function CreateProposalForm({ program, admin, onCreated, onRefresh }: {
  program: ReturnType<typeof useProgram>;
  admin: PublicKey;
  onCreated: (pda: PublicKey) => void;
  onRefresh: () => void;
}) {
  const [title, setTitle] = useState("");
  const [desc, setDesc] = useState("");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");

  async function submit() {
    if (!program) return;
    const pda = getProposalPda(admin, title);
    const votingStart = new BN(Math.floor(new Date(start).getTime() / 1000));
    const votingEnd   = new BN(Math.floor(new Date(end).getTime() / 1000));
    await program.methods
      .createProposal(title, desc, votingStart, votingEnd)
      .accounts({ admin, proposal: pda })
      .rpc();
    onCreated(pda);
    onRefresh();
  }

  return (
    <section className="bg-white rounded-xl border border-slate-200 p-5 space-y-4">
      <h3 className="font-semibold text-slate-800">Create Proposal</h3>
      <input
        className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
        placeholder="Title (max 32 bytes)"
        value={title} onChange={e => setTitle(e.target.value)}
        maxLength={32}
      />
      <textarea
        className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
        placeholder="Description"
        rows={2}
        value={desc} onChange={e => setDesc(e.target.value)}
      />
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs text-slate-500">Voting opens</label>
          <input type="datetime-local" className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
            value={start} onChange={e => setStart(e.target.value)} />
        </div>
        <div>
          <label className="text-xs text-slate-500">Voting closes</label>
          <input type="datetime-local" className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
            value={end} onChange={e => setEnd(e.target.value)} />
        </div>
      </div>
      <TxButton label="Create Proposal" onClick={submit} disabled={!title || !start || !end} />
    </section>
  );
}

// ── Register Voter ────────────────────────────────────────────────────────────

function RegisterVoterForm({ program, proposalPda, onRefresh }: {
  program: ReturnType<typeof useProgram>;
  proposalPda: PublicKey;
  onRefresh: () => void;
}) {
  const [hex, setHex] = useState("");

  function fillTest() {
    setHex("01".repeat(32));
  }

  async function submit() {
    if (!program) return;
    const commitment = Array.from(Buffer.from(hex.replace(/\s/g, ""), "hex"));
    await program.methods
      .registerVoter(commitment as number[])
      .accounts({ proposal: proposalPda })
      .rpc();
    setHex("");
    onRefresh();
  }

  const valid = /^[0-9a-fA-F]{64}$/.test(hex.replace(/\s/g, ""));

  return (
    <section className="bg-white rounded-xl border border-slate-200 p-5 space-y-3">
      <h3 className="font-semibold text-slate-800">Register Voter</h3>
      <p className="text-xs text-slate-500">
        Paste the voter's 32-byte commitment as a 64-character hex string (Poseidon of their secret key + randomness).
      </p>
      <div className="flex gap-2">
        <input
          className="flex-1 border border-slate-300 rounded-lg px-3 py-2 text-sm font-mono"
          placeholder="64-char hex commitment"
          value={hex} onChange={e => setHex(e.target.value)}
        />
        <button
          onClick={fillTest}
          className="px-3 py-2 text-xs bg-slate-100 hover:bg-slate-200 rounded-lg text-slate-600"
        >
          Test value
        </button>
      </div>
      <TxButton label="Register Voter" onClick={submit} disabled={!valid} />
    </section>
  );
}

// ── Lifecycle Controls ────────────────────────────────────────────────────────

function LifecycleControls({ program, proposalPda, status, voterCount, onRefresh }: {
  program: ReturnType<typeof useProgram>;
  proposalPda: PublicKey;
  status: string;
  voterCount: number;
  onRefresh: () => void;
}) {
  async function openVoting() {
    await program!.methods.openVoting()
      .accounts({ proposal: proposalPda }).rpc();
    onRefresh();
  }
  async function closeVoting() {
    await program!.methods.closeVoting()
      .accounts({ proposal: proposalPda }).rpc();
    onRefresh();
  }
  async function finalizeTally() {
    await program!.methods.finalizeTally()
      .accounts({ proposal: proposalPda }).rpc();
    onRefresh();
  }

  return (
    <section className="bg-white rounded-xl border border-slate-200 p-5 space-y-3">
      <h3 className="font-semibold text-slate-800">Proposal Lifecycle</h3>
      <div className="flex gap-3 flex-wrap">
        <TxButton
          label="Open Voting"
          onClick={openVoting}
          disabled={status !== "registration" || voterCount === 0}
        />
        <TxButton
          label="Close Voting"
          onClick={closeVoting}
          disabled={status !== "voting"}
          variant="danger"
        />
        <TxButton
          label="Finalize Tally"
          onClick={finalizeTally}
          disabled={status !== "closed"}
          variant="secondary"
        />
      </div>
      {status === "registration" && voterCount === 0 && (
        <p className="text-xs text-yellow-600">Register at least one voter before opening voting.</p>
      )}
    </section>
  );
}

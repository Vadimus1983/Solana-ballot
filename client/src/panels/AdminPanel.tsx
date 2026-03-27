import { useState } from "react";
import { BN } from "@coral-xyz/anchor";
import { useWallet } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import { useProgram } from "../hooks/useProgram";
import { TxButton } from "../components/TxButton";
import { getProposalPda, getRootHistoryPda } from "../lib/pda";
import type { ProposalAccount } from "../hooks/useProposal";

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
    : true;

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

      {proposal && status === "registration" && (
        <ReplaceVkNotice />
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

    // program_config is auto-derived by Anchor (PDA seeds ["config"] in IDL).
    await program.methods
      .createProposal(title, desc, votingStart, votingEnd)
      .accounts({ admin, proposal: pda, rootHistoryAccount: getRootHistoryPda(pda) })
      .rpc();

    onCreated(pda);
    onRefresh();
  }

  return (
    <section className="bg-white rounded-xl border border-slate-200 p-5 space-y-4">
      <h3 className="font-semibold text-slate-800">Create Proposal</h3>
      <input
        className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
        placeholder="Title (max 128 chars)"
        value={title} onChange={e => setTitle(e.target.value)}
        maxLength={128}
      />
      <textarea
        className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
        placeholder="Description (max 256 chars)"
        rows={2}
        value={desc} onChange={e => setDesc(e.target.value)}
        maxLength={256}
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
  const [voterAddress, setVoterAddress] = useState("");

  async function submit() {
    if (!program) return;

    let voterPubkey: PublicKey;
    try {
      voterPubkey = new PublicKey(voterAddress.trim());
    } catch {
      alert("Invalid voter public key.");
      return;
    }

    // register_voter takes no args — the commitment is read from the
    // PendingCommitmentRecord the voter submitted via register_commitment.
    // All PDAs (pending_commitment, commitment_record, voter_record) are
    // auto-derived by Anchor from the IDL seeds using voter + proposal.
    await program.methods
      .registerVoter()
      .accounts({ voter: voterPubkey, proposal: proposalPda, rootHistoryAccount: getRootHistoryPda(proposalPda) })
      .rpc();

    setVoterAddress("");
    onRefresh();
  }

  const valid = (() => { try { new PublicKey(voterAddress.trim()); return true; } catch { return false; } })();

  return (
    <section className="bg-white rounded-xl border border-slate-200 p-5 space-y-3">
      <h3 className="font-semibold text-slate-800">Register Voter</h3>
      <p className="text-xs text-slate-500">
        Enter the voter's Solana public key. The voter must have already called{" "}
        <strong>Register Commitment</strong> (step 1 of the two-phase registration protocol)
        before you can register them here.
      </p>
      <input
        className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm font-mono"
        placeholder="Voter public key (base58)"
        value={voterAddress}
        onChange={e => setVoterAddress(e.target.value)}
      />
      <TxButton label="Register Voter" onClick={submit} disabled={!valid} />
    </section>
  );
}

// ── Replace VK Notice ─────────────────────────────────────────────────────────

function ReplaceVkNotice() {
  return (
    <section className="bg-amber-50 border border-amber-200 rounded-xl p-5 space-y-2">
      <h3 className="font-semibold text-amber-800 text-sm">Wrong VK uploaded?</h3>
      <p className="text-xs text-amber-700">
        If an incorrect verification key was stored via <code>store_vk</code>, you can replace
        it using the <code>replace_vk</code> instruction — but only while the proposal is still
        in <strong>Registration</strong>. Once voting opens the key is permanently frozen.
      </p>
      <p className="text-xs text-amber-600 font-mono">
        anchor client replace_vk &lt;proposal&gt; &lt;vk_alpha&gt; &lt;vk_beta&gt; ...
      </p>
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
  // open_voting: admin (via `relations`) + proposal (passed) + vk_account (auto-derived).
  async function openVoting() {
    await program!.methods.openVoting()
      .accounts({ proposal: proposalPda })
      .rpc();
    onRefresh();
  }

  // close_voting: closer (wallet, any signer) + proposal (passed, auto-PDA verified).
  async function closeVoting() {
    await program!.methods.closeVoting()
      .accounts({ proposal: proposalPda })
      .rpc();
    onRefresh();
  }

  // finalize_tally: finalizer (wallet, any signer) + proposal (passed, auto-PDA verified).
  async function finalizeTally() {
    await program!.methods.finalizeTally()
      .accounts({ proposal: proposalPda })
      .rpc();
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

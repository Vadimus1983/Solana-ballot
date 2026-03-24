import { useWallet } from "@solana/wallet-adapter-react";
import { useProgram } from "../hooks/useProgram";
import { TxButton } from "../components/TxButton";
import {
  DEV_PROOF,
  DEV_RANDOMNESS,
  computeDevCommitment,
  generateDevNullifier,
  generateDevCommitment,
} from "../lib/devProof";
import { getVoteRecordPda } from "../lib/pda";
import type { ProposalAccount } from "../hooks/useProposal";
import type { PublicKey } from "@solana/web3.js";

// ── localStorage helpers ──────────────────────────────────────────────────────

interface RegistrationState {
  commitment: number[];
}

interface BallotState {
  proposalPda: string;
  nullifier: number[];
  vote: 0 | 1;
  randomness: number[];
  revealed: boolean;
}

function regKey(proposalPda: string) { return `reg_${proposalPda}`; }
function ballotKey() { return "ballotState"; }

function loadRegistration(proposalPda: string): RegistrationState | null {
  try {
    const raw = localStorage.getItem(regKey(proposalPda));
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

function saveRegistration(proposalPda: string, state: RegistrationState) {
  localStorage.setItem(regKey(proposalPda), JSON.stringify(state));
}

function loadBallot(proposalPda: string): BallotState | null {
  try {
    const raw = localStorage.getItem(ballotKey());
    if (!raw) return null;
    const s: BallotState = JSON.parse(raw);
    return s.proposalPda === proposalPda ? s : null;
  } catch { return null; }
}

function saveBallot(state: BallotState) {
  localStorage.setItem(ballotKey(), JSON.stringify(state));
}

// ── Root component ────────────────────────────────────────────────────────────

interface Props {
  proposal: ProposalAccount | null;
  proposalPda: PublicKey | null;
  onRefresh: () => void;
}

export function VoterPanel({ proposal, proposalPda, onRefresh }: Props) {
  const { publicKey } = useWallet();
  const program = useProgram();

  if (!publicKey) return <p className="text-slate-500">Connect your wallet to vote.</p>;
  if (!proposal || !proposalPda || !program) return <p className="text-slate-500">No active proposal.</p>;

  const status = Object.keys(proposal.status)[0];
  const reg = loadRegistration(proposalPda.toBase58());
  const ballot = loadBallot(proposalPda.toBase58());

  if (status === "registration") {
    if (reg) {
      return <Notice>Commitment submitted. Waiting for the admin to complete your registration.</Notice>;
    }
    return (
      <RegisterCommitmentForm
        program={program}
        voter={publicKey}
        proposalPda={proposalPda}
        onSuccess={onRefresh}
      />
    );
  }

  if (status === "voting") {
    if (ballot && !ballot.revealed) {
      return <Notice>Vote cast! Wait for voting to close, then come back to reveal your vote.</Notice>;
    }
    return (
      <CastVoteForm
        program={program}
        voter={publicKey}
        proposalPda={proposalPda}
        onSuccess={onRefresh}
      />
    );
  }

  if (status === "closed") {
    if (!ballot) return <Notice>You did not cast a vote in this round.</Notice>;
    if (ballot.revealed) return <Notice>You have already revealed your vote. See the Results tab.</Notice>;
    return (
      <RevealVoteForm
        program={program}
        proposalPda={proposalPda}
        ballot={ballot}
        onSuccess={onRefresh}
      />
    );
  }

  return <Notice>Voting is complete — see the Results tab.</Notice>;
}

function Notice({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-slate-50 border border-slate-200 rounded-xl p-6 text-slate-600">
      {children}
    </div>
  );
}

// ── Register Commitment (step 1 of two-phase registration) ────────────────────

function RegisterCommitmentForm({ program, voter, proposalPda, onSuccess }: {
  program: NonNullable<ReturnType<typeof useProgram>>;
  voter: PublicKey;
  proposalPda: PublicKey;
  onSuccess: () => void;
}) {
  async function submit() {
    const commitment = generateDevCommitment();

    // proposal PDA is auto-derived by Anchor (IDL has its seeds).
    // pending_commitment PDA is auto-derived from [proposal, voter].
    await program.methods
      .registerCommitment(Array.from(commitment) as number[] & { length: 32 })
      .accounts({ voter, proposal: proposalPda })
      .rpc();

    saveRegistration(proposalPda.toBase58(), { commitment: Array.from(commitment) });
    onSuccess();
  }

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-6 space-y-4">
      <h3 className="font-semibold text-slate-800">Register to Vote</h3>
      <p className="text-sm text-slate-500">
        Submit your voter commitment to be included in this election.
        A random commitment is generated for you in dev mode — in production
        this would be derived from your secret key using Poseidon hashing.
        After submitting, the admin will complete your registration.
      </p>
      <TxButton label="Submit Commitment" onClick={submit} />
    </div>
  );
}

// ── Cast Vote ─────────────────────────────────────────────────────────────────

function CastVoteForm({ program, voter, proposalPda, onSuccess }: {
  program: NonNullable<ReturnType<typeof useProgram>>;
  voter: PublicKey;
  proposalPda: PublicKey;
  onSuccess: () => void;
}) {
  async function castVote(vote: 0 | 1) {
    const nullifier = generateDevNullifier();
    const voteCommitment = computeDevCommitment(vote, DEV_RANDOMNESS);

    // nullifier_record and vote_record PDAs are auto-derived by Anchor
    // (seeded by [nullifier, proposal] — in IDL with "arg" kind for nullifier).
    // vk_account is auto-derived from [\"vk\", proposal] (also in IDL).
    // refund_to = voter so the voter reclaims rent after cleanup.
    await program.methods
      .castVote(
        Buffer.from(DEV_PROOF),         // proof: Vec<u8>
        Array.from(nullifier),          // nullifier: [u8; 32]
        Array.from(voteCommitment),     // vote_commitment: [u8; 32]
        voter,                          // refund_to: Pubkey
      )
      .accounts({
        voter,
        proposal: proposalPda,
      })
      .rpc();

    saveBallot({
      proposalPda: proposalPda.toBase58(),
      nullifier: Array.from(nullifier),
      vote,
      randomness: Array.from(DEV_RANDOMNESS),
      revealed: false,
    });

    onSuccess();
  }

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-6 space-y-4">
      <h3 className="font-semibold text-slate-800">Cast Your Vote</h3>
      <p className="text-sm text-slate-500">
        Your vote is private. A ZK proof (256-byte dummy in dev mode) prevents double voting and
        hides your identity. Your vote is committed now and revealed after voting closes.
      </p>
      <div className="flex gap-4">
        <TxButton label="✓  Vote YES" onClick={() => castVote(1)} variant="primary" />
        <TxButton label="✗  Vote NO"  onClick={() => castVote(0)} variant="danger" />
      </div>
    </div>
  );
}

// ── Reveal Vote ───────────────────────────────────────────────────────────────

function RevealVoteForm({ program, proposalPda, ballot, onSuccess }: {
  program: NonNullable<ReturnType<typeof useProgram>>;
  proposalPda: PublicKey;
  ballot: BallotState;
  onSuccess: () => void;
}) {
  async function reveal() {
    const nullifier   = new Uint8Array(ballot.nullifier);
    const randomness  = new Uint8Array(ballot.randomness);
    const voteRecordPda = getVoteRecordPda(proposalPda, nullifier);

    // reveal_vote signer is `revealer` — any account, not necessarily the voter.
    // Passing vote_record explicitly since its seed path references a stored
    // field (nullifier) that Anchor cannot pre-fetch without the account address.
    await program.methods
      .revealVote(ballot.vote, Array.from(randomness))
      .accounts({
        proposal: proposalPda,
        voteRecord: voteRecordPda,
      })
      .rpc();

    saveBallot({ ...ballot, revealed: true });
    onSuccess();
  }

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-6 space-y-4">
      <h3 className="font-semibold text-slate-800">Reveal Your Vote</h3>
      <p className="text-sm text-slate-500">
        You voted <strong>{ballot.vote === 1 ? "YES" : "NO"}</strong>. Revealing adds your
        vote to the on-chain tally.
      </p>
      <TxButton label="Reveal Vote" onClick={reveal} />
    </div>
  );
}

import { useState, useEffect } from "react";
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
import { getVoteRecordPda, getRootHistoryPda } from "../lib/pda";
import type { ProposalAccount } from "../hooks/useProposal";
import { ComputeBudgetProgram } from "@solana/web3.js";
import type { PublicKey } from "@solana/web3.js";
import {
  notificationsSupported,
  notificationPermission,
  requestNotificationPermission,
} from "../lib/notifications";

const REVEAL_GRACE_SECONDS = 86_400; // 24 h — must match on-chain REVEAL_GRACE_PERIOD

/** Returns a live "Xh Ym Zs" countdown string to `targetUnixSeconds`. */
function useCountdown(targetUnixSeconds: number): { label: string; expired: boolean; urgent: boolean } {
  const [remaining, setRemaining] = useState(() =>
    Math.max(0, targetUnixSeconds - Math.floor(Date.now() / 1000))
  );

  useEffect(() => {
    const tick = () =>
      setRemaining(Math.max(0, targetUnixSeconds - Math.floor(Date.now() / 1000)));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [targetUnixSeconds]);

  if (remaining === 0) return { label: "Expired", expired: true, urgent: true };
  const h = Math.floor(remaining / 3600);
  const m = Math.floor((remaining % 3600) / 60);
  const s = remaining % 60;
  return {
    label: `${h}h ${String(m).padStart(2, "0")}m ${String(s).padStart(2, "0")}s`,
    expired: false,
    urgent: remaining < 6 * 3600, // warn when < 6 hours left
  };
}

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
      return (
        <div className="space-y-3">
          <NotificationOptIn />
          <Notice>Commitment submitted. Waiting for the admin to complete your registration.</Notice>
        </div>
      );
    }
    return (
      <div className="space-y-3">
        <NotificationOptIn />
        <RegisterCommitmentForm
          program={program}
          voter={publicKey}
          proposalPda={proposalPda}
          onSuccess={onRefresh}
        />
      </div>
    );
  }

  if (status === "voting") {
    if (ballot && !ballot.revealed) {
      return (
        <div className="space-y-3">
          <NotificationOptIn />
          <VotingClosesNotice votingEndUnix={proposal.votingEnd.toNumber()} />
        </div>
      );
    }
    return (
      <div className="space-y-3">
        <NotificationOptIn />
        <CastVoteForm
          program={program}
          voter={publicKey}
          proposalPda={proposalPda}
          merkleRoot={proposal.merkleRoot}
          onSuccess={onRefresh}
        />
      </div>
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
        votingEndUnix={proposal.votingEnd.toNumber()}
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

/**
 * Asks the voter to enable browser notifications so they are alerted when the
 * proposal transitions phases (Registration → Voting → Closed → Finalized).
 * Hidden once permission is granted or denied.
 */
function NotificationOptIn() {
  const [permission, setPermission] = useState<string>(() =>
    notificationsSupported() ? notificationPermission() : "unsupported"
  );

  // Re-check permission state in case it changed outside the app.
  useEffect(() => {
    if (!notificationsSupported()) return;
    setPermission(notificationPermission());
  }, []);

  // Already resolved — nothing to show.
  if (permission === "granted" || permission === "denied" || permission === "unsupported") {
    return null;
  }

  return (
    <div className="flex items-center justify-between bg-indigo-50 border border-indigo-200 rounded-lg px-4 py-3 text-sm">
      <span className="text-indigo-700">
        Get notified when voting opens or closes.
      </span>
      <button
        onClick={async () => {
          const granted = await requestNotificationPermission();
          setPermission(granted ? "granted" : "denied");
        }}
        className="ml-4 shrink-0 text-xs font-medium text-indigo-600 hover:text-indigo-800 underline underline-offset-2"
      >
        Enable notifications
      </button>
    </div>
  );
}

/** Shown after a vote is cast while voting is still open. */
function VotingClosesNotice({ votingEndUnix }: { votingEndUnix: number }) {
  const { label, expired } = useCountdown(votingEndUnix);
  return (
    <div className="bg-slate-50 border border-slate-200 rounded-xl p-6 space-y-1 text-slate-600">
      <p>Vote cast! Come back to reveal after voting closes.</p>
      <p className="text-sm font-mono text-slate-500">
        {expired ? "Voting period has ended — go to the Reveal tab." : `Voting closes in ${label}`}
      </p>
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

function CastVoteForm({ program, voter, proposalPda, merkleRoot, onSuccess }: {
  program: NonNullable<ReturnType<typeof useProgram>>;
  voter: PublicKey;
  proposalPda: PublicKey;
  merkleRoot: number[];
  onSuccess: () => void;
}) {
  async function castVote(vote: 0 | 1) {
    const nullifier = generateDevNullifier();
    const voteCommitment = computeDevCommitment(vote, DEV_RANDOMNESS);

    // Groth16 alt_bn128 pairing verification consumes ~1.4 M CU — well above
    // the default 200 k CU limit. Prepend SetComputeUnitLimit so the transaction
    // is never silently rejected with ComputationalBudgetExceeded.
    await program.methods
      .castVote(
        Buffer.from(DEV_PROOF),         // proof: Vec<u8>
        Array.from(nullifier),          // nullifier: [u8; 32]
        Array.from(voteCommitment),     // vote_commitment: [u8; 32]
        merkleRoot,                     // merkle_root: [u8; 32]
        voter,                          // refund_to: Pubkey
      )
      .accounts({
        voter,
        proposal: proposalPda,
        rootHistoryAccount: getRootHistoryPda(proposalPda),
      })
      .preInstructions([
        ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 }),
      ])
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

function RevealVoteForm({ program, proposalPda, ballot, votingEndUnix, onSuccess }: {
  program: NonNullable<ReturnType<typeof useProgram>>;
  proposalPda: PublicKey;
  ballot: BallotState;
  votingEndUnix: number;
  onSuccess: () => void;
}) {
  const revealDeadlineUnix = votingEndUnix + REVEAL_GRACE_SECONDS;
  const { label, expired, urgent } = useCountdown(revealDeadlineUnix);

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

      {/* Reveal deadline warning */}
      <div className={`rounded-lg px-4 py-3 text-sm ${
        expired
          ? "bg-red-50 border border-red-300 text-red-700"
          : urgent
          ? "bg-yellow-50 border border-yellow-300 text-yellow-800"
          : "bg-blue-50 border border-blue-200 text-blue-700"
      }`}>
        {expired ? (
          <span>⛔ Reveal window has closed. Your vote will not be counted in the tally.</span>
        ) : (
          <span>
            {urgent ? "⚠️ " : "ℹ️ "}
            Reveal deadline: <span className="font-mono font-semibold">{label}</span> remaining.
            {urgent && " Reveal now to ensure your vote is counted."}
          </span>
        )}
      </div>

      <p className="text-sm text-slate-500">
        You voted <strong>{ballot.vote === 1 ? "YES" : "NO"}</strong>. Revealing adds your
        vote to the on-chain tally.
      </p>
      <TxButton label="Reveal Vote" onClick={reveal} disabled={expired} />
    </div>
  );
}

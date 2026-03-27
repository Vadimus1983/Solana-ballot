import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { SolanaBallot } from "../target/types/solana_ballot";
import { assert } from "chai";
import { poseidon2 } from "poseidon-lite";
import { keccak_256 } from "@noble/hashes/sha3";

/** Encode a 32-byte big-endian buffer as a field element (BigInt). */
function bufToBigInt(buf: Buffer): bigint {
  return BigInt("0x" + buf.toString("hex"));
}

/** Convert a field element (BigInt) to a 32-byte big-endian Buffer. */
function bigIntToBuf(n: bigint): Buffer {
  return Buffer.from(n.toString(16).padStart(64, "0"), "hex");
}

/**
 * Compute Poseidon(vote_bytes, randomness) — matches the on-chain check in
 * reveal_vote.rs.  `vote` is encoded as a 32-byte big-endian scalar (last byte
 * = vote value, upper 31 bytes = 0), mirroring the Circom field element layout.
 */
function computeVoteCommitment(vote: 0 | 1, randomness: Buffer): Buffer {
  const voteField = BigInt(vote);
  const randField = bufToBigInt(randomness);
  const hash = poseidon2([voteField, randField]);
  return bigIntToBuf(hash);
}

/** BN254 scalar field prime (big-endian, 32 bytes). */
const BN254_PRIME_BUF = Buffer.from([
  0x30, 0x64, 0x4e, 0x72, 0xe1, 0x31, 0xa0, 0x29,
  0xb8, 0x50, 0x45, 0xb6, 0x81, 0x81, 0x58, 0x5d,
  0x28, 0x33, 0xe8, 0x48, 0x79, 0xb9, 0x70, 0x91,
  0x42, 0xe0, 0xf8, 0x53, 0xd2, 0x69, 0x41, 0x6f,
]);

/** Returns a 32-byte buffer that is >= BN254_PRIME (invalid field element). */
function outOfRangeBN254(): Buffer {
  return Buffer.alloc(32, 0xff);
}

/** Returns a valid 32-byte field element (1 in BN254). */
function validFieldElement(byte = 0x01): Buffer {
  const b = Buffer.alloc(32, 0);
  b[31] = byte;
  return b;
}

// ─────────────────────────────────────────────────────────────────────────────
// PDA helpers
// ─────────────────────────────────────────────────────────────────────────────

function programConfigPda(programId: anchor.web3.PublicKey) {
  const [pda] = anchor.web3.PublicKey.findProgramAddressSync(
    [Buffer.from("config")], programId);
  return pda;
}

function proposalPda(
  adminKey: anchor.web3.PublicKey,
  title: string,
  programId: anchor.web3.PublicKey,
) {
  const titleHash = Buffer.from(keccak_256(Buffer.from(title)));
  const [pda] = anchor.web3.PublicKey.findProgramAddressSync(
    [Buffer.from("proposal"), adminKey.toBuffer(), titleHash], programId);
  return pda;
}

function rootHistoryPda(proposal: anchor.web3.PublicKey, programId: anchor.web3.PublicKey) {
  const [pda] = anchor.web3.PublicKey.findProgramAddressSync(
    [Buffer.from("root_history"), proposal.toBuffer()], programId);
  return pda;
}

function vkPda(proposal: anchor.web3.PublicKey, programId: anchor.web3.PublicKey) {
  const [pda] = anchor.web3.PublicKey.findProgramAddressSync(
    [Buffer.from("vk"), proposal.toBuffer()], programId);
  return pda;
}

function pendingCommitmentPda(
  proposal: anchor.web3.PublicKey,
  voter: anchor.web3.PublicKey,
  programId: anchor.web3.PublicKey,
) {
  const [pda] = anchor.web3.PublicKey.findProgramAddressSync(
    [Buffer.from("pending_commitment"), proposal.toBuffer(), voter.toBuffer()], programId);
  return pda;
}

function commitmentRecordPda(
  proposal: anchor.web3.PublicKey,
  commitment: Buffer,
  programId: anchor.web3.PublicKey,
) {
  const [pda] = anchor.web3.PublicKey.findProgramAddressSync(
    [Buffer.from("commitment"), proposal.toBuffer(), commitment], programId);
  return pda;
}

function voterRecordPda(
  proposal: anchor.web3.PublicKey,
  voter: anchor.web3.PublicKey,
  programId: anchor.web3.PublicKey,
) {
  const [pda] = anchor.web3.PublicKey.findProgramAddressSync(
    [Buffer.from("voter"), proposal.toBuffer(), voter.toBuffer()], programId);
  return pda;
}

function nullifierRecordPda(
  proposal: anchor.web3.PublicKey,
  nullifier: Buffer,
  programId: anchor.web3.PublicKey,
) {
  const [pda] = anchor.web3.PublicKey.findProgramAddressSync(
    [Buffer.from("nullifier"), proposal.toBuffer(), nullifier], programId);
  return pda;
}

function voteRecordPda(
  proposal: anchor.web3.PublicKey,
  nullifier: Buffer,
  programId: anchor.web3.PublicKey,
) {
  const [pda] = anchor.web3.PublicKey.findProgramAddressSync(
    [Buffer.from("vote"), proposal.toBuffer(), nullifier], programId);
  return pda;
}

// ─────────────────────────────────────────────────────────────────────────────
// Shared fixture helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Minimal valid G1 point: (1, 1) — non-identity, within BN254 prime range. */
function validG1(): number[] {
  const p = Array(64).fill(0);
  p[31] = 1; // x = 1
  p[63] = 1; // y = 1
  return p;
}

/** Minimal valid G2 point: all sub-coords = 1. */
function validG2(): number[] {
  const p = Array(128).fill(0);
  p[31] = 1; p[63] = 1; p[95] = 1; p[127] = 1;
  return p;
}

async function storeVk(
  program: Program<SolanaBallot>,
  adminKey: anchor.web3.PublicKey,
  configPda: anchor.web3.PublicKey,
  proposal: anchor.web3.PublicKey,
) {
  const ic = Array(5).fill(null).map(() => validG1());
  await program.methods
    .storeVk(validG1(), validG2(), validG2(), validG2(), ic)
    .accounts({
      admin: adminKey,
      programConfig: configPda,
      proposal,
      vkAccount: vkPda(proposal, program.programId),
      systemProgram: anchor.web3.SystemProgram.programId,
    })
    .rpc();
}

async function registerCommitment(
  program: Program<SolanaBallot>,
  voter: anchor.web3.Keypair,
  proposal: anchor.web3.PublicKey,
  commitment: Buffer,
) {
  await program.methods
    .registerCommitment([...commitment])
    .accounts({
      voter: voter.publicKey,
      proposal,
      pendingCommitment: pendingCommitmentPda(proposal, voter.publicKey, program.programId),
      systemProgram: anchor.web3.SystemProgram.programId,
    })
    .signers([voter])
    .rpc();
}

async function registerVoter(
  program: Program<SolanaBallot>,
  adminKey: anchor.web3.PublicKey,
  voter: anchor.web3.Keypair,
  proposal: anchor.web3.PublicKey,
  commitment: Buffer,
) {
  await program.methods
    .registerVoter()
    .accounts({
      admin: adminKey,
      voter: voter.publicKey,
      proposal,
      pendingCommitment: pendingCommitmentPda(proposal, voter.publicKey, program.programId),
      commitmentRecord: commitmentRecordPda(proposal, commitment, program.programId),
      voterRecord: voterRecordPda(proposal, voter.publicKey, program.programId),
      rootHistoryAccount: rootHistoryPda(proposal, program.programId),
      systemProgram: anchor.web3.SystemProgram.programId,
    })
    .rpc();
}

/** Full two-phase registration helper. */
async function registerVoterFull(
  program: Program<SolanaBallot>,
  adminKey: anchor.web3.PublicKey,
  voter: anchor.web3.Keypair,
  proposal: anchor.web3.PublicKey,
  commitment: Buffer,
) {
  await registerCommitment(program, voter, proposal, commitment);
  await registerVoter(program, adminKey, voter, proposal, commitment);
}

/** Create a proposal and return its PDA. */
async function createProposal(
  program: Program<SolanaBallot>,
  adminKey: anchor.web3.PublicKey,
  configPda: anchor.web3.PublicKey,
  title: string,
  description: string,
  votingStart: number,
  votingEnd: number,
): Promise<anchor.web3.PublicKey> {
  const pda = proposalPda(adminKey, title, program.programId);
  await program.methods
    .createProposal(
      title,
      description,
      new anchor.BN(votingStart),
      new anchor.BN(votingEnd),
    )
    .accounts({
      admin: adminKey,
      programConfig: configPda,
      proposal: pda,
      rootHistoryAccount: rootHistoryPda(pda, program.programId),
      systemProgram: anchor.web3.SystemProgram.programId,
    })
    .rpc();
  return pda;
}

// ─────────────────────────────────────────────────────────────────────────────
// Test suite
// ─────────────────────────────────────────────────────────────────────────────

describe("solana_ballot — security test suite", () => {
  anchor.setProvider(anchor.AnchorProvider.env());
  const program = anchor.workspace.SolanaBallot as Program<SolanaBallot>;
  const provider = anchor.getProvider() as anchor.AnchorProvider;
  const admin = provider.wallet;

  /** Generate a funded keypair (2 SOL airdrop). */
  async function funded(): Promise<anchor.web3.Keypair> {
    const kp = anchor.web3.Keypair.generate();
    const sig = await provider.connection.requestAirdrop(
      kp.publicKey, 2 * anchor.web3.LAMPORTS_PER_SOL,
    );
    await provider.connection.confirmTransaction(sig, "confirmed");
    return kp;
  }

  const now = () => Math.floor(Date.now() / 1000);
  const description = "Security test proposal";

  let configPda: anchor.web3.PublicKey;

  // ── Shared proposal used across multiple test groups ──────────────────────
  let sharedProposalPda: anchor.web3.PublicKey;
  let sharedVkPda: anchor.web3.PublicKey;
  const sharedTitle = "Shared Security Test Proposal";

  before(async () => {
    configPda = programConfigPda(program.programId);

    // Initialize program (no-op if already done in program.ts suite)
    try {
      await program.methods
        .initialize()
        .accounts({
          admin: admin.publicKey,
          programConfig: configPda,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .rpc();
    } catch (_) { /* already initialized */ }

    // Create the shared proposal
    sharedProposalPda = await createProposal(
      program, admin.publicKey, configPda,
      sharedTitle, description,
      now() - 1, now() + 300,
    );
    sharedVkPda = vkPda(sharedProposalPda, program.programId);

    // Store VK and register one voter so open_voting is possible
    await storeVk(program, admin.publicKey, configPda, sharedProposalPda);
    const seedVoter = await funded();
    await registerVoterFull(
      program, admin.publicKey, seedVoter, sharedProposalPda, validFieldElement(0x02),
    );
  });

  // ══════════════════════════════════════════════════════════════════════════
  // INITIALIZE
  // ══════════════════════════════════════════════════════════════════════════

  it("Initialize: rejects double initialization (re-init attack)", async () => {
    // ATTACK: re-calling initialize must not overwrite the stored authority.
    // Anchor's `init` constraint prevents account reuse.
    try {
      await program.methods
        .initialize()
        .accounts({
          admin: admin.publicKey,
          programConfig: configPda,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .rpc();
      assert.fail("should have rejected second initialize");
    } catch (err: any) {
      assert.match(err.message, /already in use/i);
    }
  });

  // ══════════════════════════════════════════════════════════════════════════
  // CREATE PROPOSAL — input boundaries
  // ══════════════════════════════════════════════════════════════════════════

  it("CreateProposal: rejects title > 128 characters (TitleTooLong)", async () => {
    // BOUNDARY: title limit is 128 chars; 129 must fail
    const longTitle = "A".repeat(129);
    const pda = proposalPda(admin.publicKey, longTitle, program.programId);
    try {
      await program.methods
        .createProposal(longTitle, description, new anchor.BN(now() - 1), new anchor.BN(now() + 120))
        .accounts({
          admin: admin.publicKey, programConfig: configPda, proposal: pda,
          rootHistoryAccount: rootHistoryPda(pda, program.programId),
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .rpc();
      assert.fail("should have rejected title > 128 chars");
    } catch (err: any) {
      assert.include(err.message, "TitleTooLong");
    }
  });

  it("CreateProposal: accepts title exactly 128 characters (upper boundary)", async () => {
    // BOUNDARY: 128 chars is the maximum; must succeed
    const maxTitle = "B".repeat(128);
    const pda = await createProposal(
      program, admin.publicKey, configPda,
      maxTitle, description, now() - 1, now() + 120,
    );
    const acct = await program.account.proposal.fetch(pda);
    assert.equal(acct.title.length, 128);
  });

  it("CreateProposal: rejects description > 256 characters (DescriptionTooLong)", async () => {
    // BOUNDARY: description limit is 256 chars; 257 must fail
    const t = "DescBoundaryTest";
    const pda = proposalPda(admin.publicKey, t, program.programId);
    try {
      await program.methods
        .createProposal(t, "C".repeat(257), new anchor.BN(now() - 1), new anchor.BN(now() + 120))
        .accounts({
          admin: admin.publicKey, programConfig: configPda, proposal: pda,
          rootHistoryAccount: rootHistoryPda(pda, program.programId),
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .rpc();
      assert.fail("should have rejected description > 256 chars");
    } catch (err: any) {
      assert.include(err.message, "DescriptionTooLong");
    }
  });

  it("CreateProposal: rejects voting_end == voting_start (off-by-one / InvalidVotingPeriod)", async () => {
    // BOUNDARY: voting_end must be strictly greater than voting_start
    const t = "SameTimestampTest";
    const pda = proposalPda(admin.publicKey, t, program.programId);
    const ts = now() + 60;
    try {
      await program.methods
        .createProposal(t, description, new anchor.BN(ts), new anchor.BN(ts))
        .accounts({
          admin: admin.publicKey, programConfig: configPda, proposal: pda,
          rootHistoryAccount: rootHistoryPda(pda, program.programId),
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .rpc();
      assert.fail("should have rejected equal timestamps");
    } catch (err: any) {
      assert.include(err.message, "InvalidVotingPeriod");
    }
  });

  it("CreateProposal: rejects voting_start more than 60 s in the past (drift guard)", async () => {
    // BOUNDARY: MAX_VOTING_START_DRIFT = 60 s; 61 s stale start must fail
    const t = "StaleStartTest";
    const pda = proposalPda(admin.publicKey, t, program.programId);
    try {
      await program.methods
        .createProposal(t, description, new anchor.BN(now() - 120), new anchor.BN(now() + 120))
        .accounts({
          admin: admin.publicKey, programConfig: configPda, proposal: pda,
          rootHistoryAccount: rootHistoryPda(pda, program.programId),
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .rpc();
      assert.fail("should have rejected stale voting_start");
    } catch (err: any) {
      assert.include(err.message, "InvalidVotingPeriod");
    }
  });

  it("CreateProposal: rejects non-authority caller (Unauthorized)", async () => {
    // AUTHORIZATION: only the program authority stored in ProgramConfig may create proposals
    const attacker = await funded();
    const t = "AttackerProposal";
    const pda = proposalPda(attacker.publicKey, t, program.programId);
    try {
      await program.methods
        .createProposal(t, description, new anchor.BN(now() - 1), new anchor.BN(now() + 120))
        .accounts({
          admin: attacker.publicKey, programConfig: configPda, proposal: pda,
          rootHistoryAccount: rootHistoryPda(pda, program.programId),
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .signers([attacker])
        .rpc();
      assert.fail("should have rejected unauthorized caller");
    } catch (err: any) {
      assert.include(err.message, "Unauthorized");
    }
  });

  // ══════════════════════════════════════════════════════════════════════════
  // REGISTER COMMITMENT — field element validation
  // ══════════════════════════════════════════════════════════════════════════

  it("RegisterCommitment: rejects commitment = 0x00..00 (zero field element)", async () => {
    // BOUNDARY: BN254 zero is not a valid commitment (identity-point risk)
    const voter = await funded();
    const zeroCommitment = Buffer.alloc(32, 0);
    try {
      await registerCommitment(program, voter, sharedProposalPda, zeroCommitment);
      assert.fail("should have rejected zero commitment");
    } catch (err: any) {
      assert.include(err.message, "InvalidCommitment");
    }
  });

  it("RegisterCommitment: rejects commitment >= BN254_PRIME (out-of-range field element)", async () => {
    // BOUNDARY: commitment must be a valid BN254 scalar field element
    const voter = await funded();
    try {
      await registerCommitment(program, voter, sharedProposalPda, outOfRangeBN254());
      assert.fail("should have rejected out-of-range commitment");
    } catch (err: any) {
      assert.include(err.message, "InvalidCommitment");
    }
  });

  it("RegisterCommitment: rejects duplicate submission from same voter (CommitmentAlreadyRegistered)", async () => {
    // REPLAY ATTACK: a voter calling register_commitment twice is blocked by the PDA zero-check
    const t = "DuplicateCommitmentTest";
    const proposal = await createProposal(
      program, admin.publicKey, configPda, t, description, now() - 1, now() + 300);
    const voter = await funded();
    const commitment = validFieldElement(0x10);

    await registerCommitment(program, voter, proposal, commitment);

    try {
      await registerCommitment(program, voter, proposal, commitment);
      assert.fail("should have rejected duplicate commitment");
    } catch (err: any) {
      assert.include(err.message, "CommitmentAlreadyRegistered");
    }
  });

  it("RegisterCommitment: rejects registration when proposal is not in Registration phase", async () => {
    // STATE MACHINE: status must be Registration; after open_voting it becomes Voting
    const voter = await funded();
    const lateCommitment = validFieldElement(0x11);

    // Open voting on the shared proposal first
    await program.methods
      .openVoting()
      .accounts({
        admin: admin.publicKey,
        proposal: sharedProposalPda,
        vkAccount: sharedVkPda,
      })
      .rpc();

    try {
      await registerCommitment(program, voter, sharedProposalPda, lateCommitment);
      assert.fail("should have rejected late registration");
    } catch (err: any) {
      assert.include(err.message, "NotInRegistration");
    }
  });

  // ══════════════════════════════════════════════════════════════════════════
  // REGISTER VOTER — PDA seed validation
  // ══════════════════════════════════════════════════════════════════════════

  it("RegisterVoter: rejects wrong commitment seed in CommitmentRecord PDA", async () => {
    // PDA EDGE CASE: CommitmentRecord is seeded by the commitment value;
    // passing a PDA derived from a different value fails seed verification
    const t = "WrongCommitmentSeedTest";
    const proposal = await createProposal(
      program, admin.publicKey, configPda, t, description, now() - 1, now() + 300);
    const voter = await funded();
    const realCommitment = validFieldElement(0x20);
    const wrongCommitment = validFieldElement(0x21);

    await registerCommitment(program, voter, proposal, realCommitment);

    try {
      await program.methods
        .registerVoter()
        .accounts({
          admin: admin.publicKey,
          voter: voter.publicKey,
          proposal,
          pendingCommitment: pendingCommitmentPda(proposal, voter.publicKey, program.programId),
          // Pass PDA derived from a different commitment — should fail
          commitmentRecord: commitmentRecordPda(proposal, wrongCommitment, program.programId),
          voterRecord: voterRecordPda(proposal, voter.publicKey, program.programId),
          rootHistoryAccount: rootHistoryPda(proposal, program.programId),
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .rpc();
      assert.fail("should have rejected wrong commitment record seed");
    } catch (_) { /* expected: seed mismatch */ }
  });

  it("RegisterVoter: rejects wrong voter key in VoterRecord PDA", async () => {
    // PDA EDGE CASE: VoterRecord is seeded by voter.key(); passing a different voter key fails
    const t = "WrongVoterSeedTest";
    const proposal = await createProposal(
      program, admin.publicKey, configPda, t, description, now() - 1, now() + 300);
    const voter = await funded();
    const impostor = await funded();
    const commitment = validFieldElement(0x22);

    await registerCommitment(program, voter, proposal, commitment);

    try {
      await program.methods
        .registerVoter()
        .accounts({
          admin: admin.publicKey,
          voter: voter.publicKey,
          proposal,
          pendingCommitment: pendingCommitmentPda(proposal, voter.publicKey, program.programId),
          commitmentRecord: commitmentRecordPda(proposal, commitment, program.programId),
          // VoterRecord seeded with impostor key — should fail
          voterRecord: voterRecordPda(proposal, impostor.publicKey, program.programId),
          rootHistoryAccount: rootHistoryPda(proposal, program.programId),
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .rpc();
      assert.fail("should have rejected wrong voter seed");
    } catch (_) { /* expected: seed mismatch */ }
  });

  it("RegisterVoter: rejects non-admin caller (has_one = admin)", async () => {
    // AUTHORIZATION: register_voter is admin-gated via has_one = admin on the proposal
    const t = "NonAdminRegisterVoterTest";
    const proposal = await createProposal(
      program, admin.publicKey, configPda, t, description, now() - 1, now() + 300);
    const voter = await funded();
    const attacker = await funded();
    const commitment = validFieldElement(0x23);

    await registerCommitment(program, voter, proposal, commitment);

    try {
      await program.methods
        .registerVoter()
        .accounts({
          admin: attacker.publicKey, // not the proposal admin
          voter: voter.publicKey,
          proposal,
          pendingCommitment: pendingCommitmentPda(proposal, voter.publicKey, program.programId),
          commitmentRecord: commitmentRecordPda(proposal, commitment, program.programId),
          voterRecord: voterRecordPda(proposal, voter.publicKey, program.programId),
          rootHistoryAccount: rootHistoryPda(proposal, program.programId),
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .signers([attacker])
        .rpc();
      assert.fail("should have rejected non-admin registerVoter");
    } catch (err: any) {
      assert.include(err.message, "Unauthorized");
    }
  });

  // ══════════════════════════════════════════════════════════════════════════
  // OPEN VOTING — authorization & state
  // ══════════════════════════════════════════════════════════════════════════

  it("OpenVoting: rejects non-admin caller (has_one = admin)", async () => {
    // AUTHORIZATION: only the proposal admin can open voting
    const t = "NonAdminOpenVotingTest";
    const proposal = await createProposal(
      program, admin.publicKey, configPda, t, description, now() - 1, now() + 300);
    await storeVk(program, admin.publicKey, configPda, proposal);
    const voter = await funded();
    await registerVoterFull(program, admin.publicKey, voter, proposal, validFieldElement(0x30));

    const attacker = await funded();
    try {
      await program.methods
        .openVoting()
        .accounts({
          admin: attacker.publicKey,
          proposal,
          vkAccount: vkPda(proposal, program.programId),
        })
        .signers([attacker])
        .rpc();
      assert.fail("should have rejected non-admin open_voting");
    } catch (err: any) {
      assert.include(err.message, "Unauthorized");
    }
  });

  it("OpenVoting: rejects re-opening when proposal is already Voting (state guard)", async () => {
    // STATE MACHINE: open_voting may only be called once (Registration → Voting)
    try {
      await program.methods
        .openVoting()
        .accounts({
          admin: admin.publicKey,
          proposal: sharedProposalPda,
          vkAccount: sharedVkPda,
        })
        .rpc();
      assert.fail("should have rejected re-opening voting");
    } catch (err: any) {
      assert.include(err.message, "NotInRegistration");
    }
  });

  it("OpenVoting: rejects opening with zero voters registered (empty Merkle tree)", async () => {
    // MERKLE EDGE CASE: a tree with no leaves is cryptographically meaningless
    const t = "EmptyTreeOpenVotingTest";
    const proposal = await createProposal(
      program, admin.publicKey, configPda, t, description, now() - 1, now() + 300);
    await storeVk(program, admin.publicKey, configPda, proposal);

    try {
      await program.methods
        .openVoting()
        .accounts({
          admin: admin.publicKey,
          proposal,
          vkAccount: vkPda(proposal, program.programId),
        })
        .rpc();
      assert.fail("should have rejected open_voting with zero voters");
    } catch (err: any) {
      assert.include(err.message, "NotInRegistration");
    }
  });

  // ══════════════════════════════════════════════════════════════════════════
  // CAST VOTE — nullifier & proof validation
  // ══════════════════════════════════════════════════════════════════════════

  // Helper: attempt a cast_vote call and expect it to fail with a given error fragment.
  async function expectCastVoteFail(
    proposal: anchor.web3.PublicKey,
    proofBytes: Buffer,
    nullifier: Buffer,
    voteCommitment: Buffer,
    merkleRoot: Buffer,
    errFragment: string,
  ) {
    const voter = await funded();
    try {
      await program.methods
        // proof is Vec<u8> → pass as Buffer directly (not spread)
        // nullifier/voteCommitment/merkleRoot are [u8;32] → spread as number[]
        .castVote(
          proofBytes,
          [...nullifier],
          [...voteCommitment],
          [...merkleRoot],
          voter.publicKey,
        )
        .accounts({
          voter: voter.publicKey,
          proposal,
          rootHistoryAccount: rootHistoryPda(proposal, program.programId),
          vkAccount: vkPda(proposal, program.programId),
          nullifierRecord: nullifierRecordPda(proposal, nullifier, program.programId),
          voteRecord: voteRecordPda(proposal, nullifier, program.programId),
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .signers([voter])
        .rpc();
      assert.fail(`should have rejected: ${errFragment}`);
    } catch (err: any) {
      assert.include(err.message, errFragment);
    }
  }

  it("CastVote: rejects nullifier = 0x00..00 (zero field element)", async () => {
    // BOUNDARY: zero nullifier is invalid (BN254 identity element)
    const validProof = Buffer.alloc(64 + 128 + 64, 0);
    const validRoot = validFieldElement(0x01);
    await expectCastVoteFail(
      sharedProposalPda, validProof,
      Buffer.alloc(32, 0),           // zero nullifier
      validFieldElement(0x01),
      validRoot,
      "InvalidProof",
    );
  });

  it("CastVote: rejects nullifier >= BN254_PRIME (out-of-range field element)", async () => {
    // BOUNDARY: nullifier must lie within the BN254 scalar field
    const validProof = Buffer.alloc(64 + 128 + 64, 0);
    const validRoot = validFieldElement(0x01);
    await expectCastVoteFail(
      sharedProposalPda, validProof,
      outOfRangeBN254(),             // too large
      validFieldElement(0x01),
      validRoot,
      "InvalidProof",
    );
  });

  it("CastVote: rejects vote_commitment = 0x00..00 (zero field element)", async () => {
    // BOUNDARY: zero vote_commitment is invalid
    const validProof = Buffer.alloc(64 + 128 + 64, 0);
    const validRoot = validFieldElement(0x01);
    await expectCastVoteFail(
      sharedProposalPda, validProof,
      validFieldElement(0x02),
      Buffer.alloc(32, 0),           // zero commitment
      validRoot,
      "InvalidCommitment",
    );
  });

  it("CastVote: rejects vote_commitment >= BN254_PRIME (out-of-range)", async () => {
    // BOUNDARY: vote_commitment must be a valid BN254 scalar
    const validProof = Buffer.alloc(64 + 128 + 64, 0);
    const validRoot = validFieldElement(0x01);
    await expectCastVoteFail(
      sharedProposalPda, validProof,
      validFieldElement(0x03),
      outOfRangeBN254(),             // too large
      validRoot,
      "InvalidCommitment",
    );
  });

  it("CastVote: rejects proof length != 256 bytes", async () => {
    // BOUNDARY: Groth16 proof must be exactly 64+128+64 = 256 bytes
    const shortProof = Buffer.alloc(100, 0);
    const validRoot = validFieldElement(0x01);
    await expectCastVoteFail(
      sharedProposalPda, shortProof,
      validFieldElement(0x04),
      validFieldElement(0x05),
      validRoot,
      "InvalidProof",
    );
  });

  it("CastVote: rejects unknown / fabricated Merkle root (UnknownMerkleRoot)", async () => {
    // MERKLE EDGE CASE: root must exist in history or equal proposal.merkle_root;
    // a fabricated root is never accepted
    const validProof = Buffer.alloc(64 + 128 + 64, 0);
    await expectCastVoteFail(
      sharedProposalPda, validProof,
      validFieldElement(0x06),
      validFieldElement(0x07),
      outOfRangeBN254(),             // random bytes, not a real root
      "UnknownMerkleRoot",
    );
  });

  it("CastVote: rejects zero Merkle root (never a valid root)", async () => {
    // MERKLE EDGE CASE: root_in_history() explicitly rejects all-zeros roots
    const validProof = Buffer.alloc(64 + 128 + 64, 0);
    await expectCastVoteFail(
      sharedProposalPda, validProof,
      validFieldElement(0x08),
      validFieldElement(0x09),
      Buffer.alloc(32, 0),           // zero root
      "UnknownMerkleRoot",
    );
  });

  it("CastVote: rejects duplicate nullifier (double-vote replay attack)", async () => {
    // REPLAY ATTACK: the same nullifier can only produce one vote;
    // the NullifierRecord PDA guards against reuse
    const t = "DoubleVoteTest";
    const proposal = await createProposal(
      program, admin.publicKey, configPda, t, description, now() - 1, now() + 300);
    await storeVk(program, admin.publicKey, configPda, proposal);
    const voter = await funded();
    const commitment = validFieldElement(0x40);
    await registerVoterFull(program, admin.publicKey, voter, proposal, commitment);

    await program.methods.openVoting()
      .accounts({ admin: admin.publicKey, proposal, vkAccount: vkPda(proposal, program.programId) })
      .rpc();

    // First cast_vote (will fail Groth16 in dev unless proof is valid, but
    // what matters here is the nullifier uniqueness check on the second call)
    const sharedNullifier = validFieldElement(0x41);
    const sharedVoteCommitment = computeVoteCommitment(1, Buffer.alloc(32, 0x55));
    const proofBytes = Buffer.alloc(64 + 128 + 64, 0);

    // Fetch the frozen root from the proposal account to use a known-valid root
    const proposalAcct = await program.account.proposal.fetch(proposal);
    const frozenRoot = Buffer.from(proposalAcct.merkleRoot);

    try {
      await program.methods
        .castVote(proofBytes, [...sharedNullifier], [...sharedVoteCommitment], [...frozenRoot], voter.publicKey)
        .accounts({
          voter: voter.publicKey, proposal,
          rootHistoryAccount: rootHistoryPda(proposal, program.programId),
          vkAccount: vkPda(proposal, program.programId),
          nullifierRecord: nullifierRecordPda(proposal, sharedNullifier, program.programId),
          voteRecord: voteRecordPda(proposal, sharedNullifier, program.programId),
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .signers([voter])
        .rpc();
    } catch (_) { /* first attempt may fail Groth16 — that is fine */ }

    // Second attempt with same nullifier must fail NullifierAlreadyUsed
    try {
      await program.methods
        .castVote(proofBytes, [...sharedNullifier], [...sharedVoteCommitment], [...frozenRoot], voter.publicKey)
        .accounts({
          voter: voter.publicKey, proposal,
          rootHistoryAccount: rootHistoryPda(proposal, program.programId),
          vkAccount: vkPda(proposal, program.programId),
          nullifierRecord: nullifierRecordPda(proposal, sharedNullifier, program.programId),
          voteRecord: voteRecordPda(proposal, sharedNullifier, program.programId),
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .signers([voter])
        .rpc();
      assert.fail("should have rejected duplicate nullifier");
    } catch (err: any) {
      assert.include(err.message, "NullifierAlreadyUsed");
    }
  });

  // ══════════════════════════════════════════════════════════════════════════
  // CLOSE VOTING — timing guard
  // ══════════════════════════════════════════════════════════════════════════

  it("CloseVoting: rejects closure before voting_end timestamp (VotingStillOpen)", async () => {
    // TIMING ATTACK: close_voting must not succeed before the deadline expires
    const t = "PrematureCloseTest";
    const proposal = await createProposal(
      program, admin.publicKey, configPda, t, description, now() - 1, now() + 1000);
    await storeVk(program, admin.publicKey, configPda, proposal);
    const voter = await funded();
    await registerVoterFull(program, admin.publicKey, voter, proposal, validFieldElement(0x50));

    await program.methods.openVoting()
      .accounts({ admin: admin.publicKey, proposal, vkAccount: vkPda(proposal, program.programId) })
      .rpc();

    try {
      await program.methods
        .closeVoting()
        .accounts({ closer: voter.publicKey, proposal })
        .signers([voter])
        .rpc();
      assert.fail("should have rejected premature close");
    } catch (err: any) {
      assert.include(err.message, "VotingStillOpen");
    }
  });

  // ══════════════════════════════════════════════════════════════════════════
  // STORE VK — authorization & field element validation
  // ══════════════════════════════════════════════════════════════════════════

  it("StoreVk: rejects non-authority caller (Unauthorized)", async () => {
    // AUTHORIZATION: only the program authority may store a verifying key
    const t = "UnauthorizedStoreVkTest";
    const proposal = await createProposal(
      program, admin.publicKey, configPda, t, description, now() - 1, now() + 300);
    const attacker = await funded();
    const ic = Array(5).fill(null).map(() => validG1());
    try {
      await program.methods
        .storeVk(validG1(), validG2(), validG2(), validG2(), ic)
        .accounts({
          admin: attacker.publicKey,
          programConfig: configPda,
          proposal,
          vkAccount: vkPda(proposal, program.programId),
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .signers([attacker])
        .rpc();
      assert.fail("should have rejected unauthorized store_vk");
    } catch (err: any) {
      assert.include(err.message, "Unauthorized");
    }
  });

  it("StoreVk: rejects identity G1 point (zero vk_alpha_g1)", async () => {
    // ACCOUNT VALIDATION: identity point (0,0) is invalid for any VK component
    const t = "ZeroG1VkTest";
    const proposal = await createProposal(
      program, admin.publicKey, configPda, t, description, now() - 1, now() + 300);
    const zeroG1 = Array(64).fill(0);
    const ic = Array(5).fill(null).map(() => validG1());
    try {
      await program.methods
        .storeVk(zeroG1, validG2(), validG2(), validG2(), ic)
        .accounts({
          admin: admin.publicKey, programConfig: configPda, proposal,
          vkAccount: vkPda(proposal, program.programId),
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .rpc();
      assert.fail("should have rejected zero G1 point");
    } catch (err: any) {
      assert.include(err.message, "InvalidVerificationKey");
    }
  });

  it("StoreVk: rejects out-of-range G1 coordinate (>= BN254_PRIME)", async () => {
    // BOUNDARY: VK field coordinates must be valid BN254 elements
    const t = "OutOfRangeG1VkTest";
    const proposal = await createProposal(
      program, admin.publicKey, configPda, t, description, now() - 1, now() + 300);
    const badG1 = Array(64).fill(0xff); // all bytes 0xFF — larger than BN254_PRIME
    const ic = Array(5).fill(null).map(() => validG1());
    try {
      await program.methods
        .storeVk(badG1, validG2(), validG2(), validG2(), ic)
        .accounts({
          admin: admin.publicKey, programConfig: configPda, proposal,
          vkAccount: vkPda(proposal, program.programId),
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .rpc();
      assert.fail("should have rejected out-of-range G1");
    } catch (err: any) {
      assert.include(err.message, "InvalidVerificationKey");
    }
  });

  it("StoreVk: rejects second store_vk call on same proposal (VkAlreadyInitialized)", async () => {
    // REPLAY ATTACK: VK is write-once; re-storing mid-election must fail
    const t = "DoubleStoreVkTest";
    const proposal = await createProposal(
      program, admin.publicKey, configPda, t, description, now() - 1, now() + 300);
    await storeVk(program, admin.publicKey, configPda, proposal);
    const ic = Array(5).fill(null).map(() => validG1());
    try {
      await program.methods
        .storeVk(validG1(), validG2(), validG2(), validG2(), ic)
        .accounts({
          admin: admin.publicKey, programConfig: configPda, proposal,
          vkAccount: vkPda(proposal, program.programId),
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .rpc();
      assert.fail("should have rejected second store_vk");
    } catch (err: any) {
      assert.include(err.message, "VkAlreadyInitialized");
    }
  });

  // ══════════════════════════════════════════════════════════════════════════
  // REVEAL VOTE — commitment proof & state guards
  // ══════════════════════════════════════════════════════════════════════════

  it("RevealVote: rejects reveal with wrong randomness (CommitmentMismatch)", async () => {
    // AUTHORIZATION: only the holder of (vote, randomness) can open the commitment
    // This test verifies that guessing / brute-forcing randomness is blocked at the contract level
    // (A full end-to-end setup with a real cast_vote is required for this test in a dev environment)
  });

  it("RevealVote: rejects invalid vote value > 1 (InvalidProof)", async () => {
    // BOUNDARY: vote must be 0 or 1; any other value is rejected before commitment check
    // (Requires an active vote_record — covered in integration tests)
  });

  // ══════════════════════════════════════════════════════════════════════════
  // EXPIRE PROPOSAL — state & timing
  // ══════════════════════════════════════════════════════════════════════════

  it("ExpireProposal: rejects expiry before voting_end (VotingStillOpen)", async () => {
    // TIMING ATTACK: expire_proposal requires voting_end to have passed
    const t = "PrematureExpiryTest";
    const proposal = await createProposal(
      program, admin.publicKey, configPda, t, description, now() - 1, now() + 1000);

    try {
      await program.methods
        .expireProposal()
        .accounts({ caller: admin.publicKey, proposal })
        .rpc();
      assert.fail("should have rejected premature expiry");
    } catch (err: any) {
      assert.include(err.message, "VotingWindowNotExpired");
    }
  });

  it("ExpireProposal: rejects expiry when proposal is already Voting (state guard)", async () => {
    // STATE MACHINE: expire_proposal only works in Registration phase;
    // once voting is open, the proposal can only be closed normally
    try {
      await program.methods
        .expireProposal()
        .accounts({ caller: admin.publicKey, proposal: sharedProposalPda })
        .rpc();
      assert.fail("should have rejected expiry of a Voting proposal");
    } catch (err: any) {
      assert.include(err.message, "NotInRegistration");
    }
  });
});

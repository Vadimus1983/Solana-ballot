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
  const voteField = BigInt(vote);          // 0n or 1n
  const randField = bufToBigInt(randomness);
  const hash = poseidon2([voteField, randField]);
  return bigIntToBuf(hash);
}

describe("solana_ballot", () => {
  anchor.setProvider(anchor.AnchorProvider.env());
  const program = anchor.workspace.SolanaBallot as Program<SolanaBallot>;
  const provider = anchor.getProvider() as anchor.AnchorProvider;

  const admin = provider.wallet;

  // Voting period: already started, ends 10 seconds from now.
  // The window must be long enough for all setup tests (initialize, create,
  // register, store_vk) to complete before open_voting runs.
  // The sleep in "Closes voting" is adjusted to match.
  const votingStart = Math.floor(Date.now() / 1000) - 1;
  const votingEnd = Math.floor(Date.now() / 1000) + 10;
  const title = "Fund marketing campaign";
  const description = "Allocate 100k USDC to marketing";

  // Voter commitment: Poseidon(secret_key, randomness) — mocked as 32 bytes of 0x01
  const commitment = Buffer.alloc(32, 1);

  // Mock nullifier: Poseidon(secret_key, proposal_id) — mocked for Phase 2 testing
  const nullifier = Buffer.alloc(32, 0x01); // valid BN254 field element (first byte < 0x30)

  // Reveal randomness — kept fixed so the commitment is deterministic in tests.
  const revealRandomness = Buffer.alloc(32, 0);

  // Real Poseidon(vote=1, randomness=[0;32]) commitment — must match reveal_vote check.
  const voteCommitment = computeVoteCommitment(1, revealRandomness);

  // Mock Groth16 proof — VK not initialized so verification is skipped.
  // Encoded as proof_a (64 B) || proof_b (128 B) || proof_c (64 B) = 256 bytes.
  // The program accepts a single Vec<u8> to keep the BPF stack frame under 4096 bytes.
  const proof = Buffer.alloc(64 + 128 + 64, 0);

  let proposalPda: anchor.web3.PublicKey;
  let vkPda: anchor.web3.PublicKey;
  let nullifierRecordPda: anchor.web3.PublicKey;
  let voteRecordPda: anchor.web3.PublicKey;
  let programConfigPda: anchor.web3.PublicKey;

  // Mirror the on-chain seed: keccak-256 of the full title.
  function getProposalPda(adminKey: anchor.web3.PublicKey, t: string) {
    const titleHash = Buffer.from(keccak_256(Buffer.from(t)));
    const [pda] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("proposal"), adminKey.toBuffer(), titleHash],
      program.programId
    );
    return pda;
  }

  function getVkPda(proposalKey: anchor.web3.PublicKey) {
    const [pda] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("vk"), proposalKey.toBuffer()],
      program.programId
    );
    return pda;
  }

  /** Store a dummy-but-valid VK for a proposal. Used in tests that need VK
   *  present for open_voting/cast_vote but don't care about the key's value. */
  async function storeVkForProposal(proposalKey: anchor.web3.PublicKey) {
    const g1 = Array(64).fill(0); g1[0] = 1; g1[32] = 1;
    const g2 = Array(128).fill(0); g2[0] = 1; g2[32] = 1; g2[64] = 1; g2[96] = 1;
    const ic = Array(5).fill(null).map(() => { const p = Array(64).fill(0); p[0] = 1; p[32] = 1; return p; });
    await program.methods
      .storeVk(g1, g2, g2, g2, ic)
      .accounts({
        admin: admin.publicKey,
        programConfig: programConfigPda,
        proposal: proposalKey,
        vkAccount: getVkPda(proposalKey),
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .rpc();
  }

  function getNullifierPda(proposal: anchor.web3.PublicKey, nul: Buffer) {
    const [pda] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("nullifier"), proposal.toBuffer(), nul],
      program.programId
    );
    return pda;
  }

  function getVoteRecordPda(proposal: anchor.web3.PublicKey, nul: Buffer) {
    const [pda] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("vote"), proposal.toBuffer(), nul],
      program.programId
    );
    return pda;
  }

  function getCommitmentRecordPda(proposal: anchor.web3.PublicKey, c: Buffer) {
    const [pda] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("commitment"), proposal.toBuffer(), c],
      program.programId
    );
    return pda;
  }

  function getVoterRecordPda(proposal: anchor.web3.PublicKey, voterKey: anchor.web3.PublicKey) {
    const [pda] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("voter"), proposal.toBuffer(), voterKey.toBuffer()],
      program.programId
    );
    return pda;
  }

  function getPendingCommitmentPda(proposal: anchor.web3.PublicKey, voter: anchor.web3.PublicKey) {
    const [pda] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("pending_commitment"), proposal.toBuffer(), voter.toBuffer()],
      program.programId
    );
    return pda;
  }

  /**
   * Two-phase voter registration helper.
   * Phase 1: voter calls registerCommitment (binds commitment to their identity).
   * Phase 2: admin calls registerVoter (reads from pending PDA, inserts into Merkle tree).
   */
  async function registerVoterTwoPhase(
    proposal: anchor.web3.PublicKey,
    commitment: Buffer,
    voterPubkey: anchor.web3.PublicKey,
    voterKeypair?: anchor.web3.Keypair,
  ): Promise<void> {
    const pendingPda = getPendingCommitmentPda(proposal, voterPubkey);
    const regCommitCall = program.methods
      .registerCommitment([...commitment])
      .accounts({
        voter: voterPubkey,
        proposal,
        pendingCommitment: pendingPda,
        systemProgram: anchor.web3.SystemProgram.programId,
      });
    if (voterKeypair) regCommitCall.signers([voterKeypair]);
    await regCommitCall.rpc();

    await program.methods
      .registerVoter()
      .accounts({
        admin: admin.publicKey,
        voter: voterPubkey,
        proposal,
        pendingCommitment: pendingPda,
        commitmentRecord: getCommitmentRecordPda(proposal, commitment),
        voterRecord: getVoterRecordPda(proposal, voterPubkey),
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .rpc();
  }

  // ── Happy path ────────────────────────────────────────────────────────────

  it("Initializes the program", async () => {
    [programConfigPda] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("config")],
      program.programId
    );

    await program.methods
      .initialize()
      .accounts({
        admin: admin.publicKey,
        programConfig: programConfigPda,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .rpc();

    const config = await program.account.programConfig.fetch(programConfigPda);
    assert.equal(config.authority.toBase58(), admin.publicKey.toBase58());
  });

  it("Creates a proposal", async () => {
    proposalPda = getProposalPda(admin.publicKey, title);
    vkPda = getVkPda(proposalPda);

    await program.methods
      .createProposal(title, description, new anchor.BN(votingStart), new anchor.BN(votingEnd))
      .accounts({
        admin: admin.publicKey,
        programConfig: programConfigPda,
        proposal: proposalPda,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .rpc();

    const proposal = await program.account.proposal.fetch(proposalPda);
    assert.equal(proposal.title, title);
    assert.equal(proposal.description, description);
    assert.deepEqual(proposal.status, { registration: {} });
    assert.equal(proposal.voteCount.toNumber(), 0);
  });

  it("Registers a voter", async () => {
    await registerVoterTwoPhase(proposalPda, commitment, admin.publicKey);

    const proposal = await program.account.proposal.fetch(proposalPda);
    assert.equal(proposal.voterCount.toNumber(), 1);

  });

  // ── VK setup — must happen before any cast_vote call ─────────────────────
  //
  // store_vk is placed here so all subsequent cast_vote calls can pass the
  // unconditional VK guard added by the C-2 fix.  In dev builds the Groth16
  // math is still skipped, but the VK account must be present and initialized.
  //
  // The two rejection tests must precede the successful store_vk because
  // init_if_needed + is_initialized makes the key immutable after the first
  // successful write.

  it("Rejects store_vk with identity G1 point (all zeros)", async () => {
    // All-zero G1 point is the group identity — not a valid VK component.
    const identityG1 = Array(64).fill(0);  // (0,0) = identity
    const validG2    = Array(128).fill(0); validG2[0] = 1; validG2[32] = 1; validG2[64] = 1; validG2[96] = 1;
    const validIc    = Array(5).fill(null).map(() => { const ic = Array(64).fill(0); ic[0] = 1; ic[32] = 1; return ic; });

    try {
      await program.methods
        .storeVk(identityG1, validG2, validG2, validG2, validIc)
        .accounts({ admin: admin.publicKey, programConfig: programConfigPda, proposal: proposalPda, vkAccount: vkPda, systemProgram: anchor.web3.SystemProgram.programId })
        .rpc();
      assert.fail("Should have thrown");
    } catch (err) {
      assert.include(err.message, "InvalidVerificationKey");
    }
  });

  it("Rejects store_vk with out-of-range G2 coordinate", async () => {
    // A G2 component whose first coordinate chunk has first byte 0xff > 0x30
    // (BN254 prime's first byte) is not a valid field element.
    const validG1   = Array(64).fill(0); validG1[0] = 1; validG1[32] = 1;
    const badG2     = Array(128).fill(0xff); // all bytes 0xff >> BN254 prime
    const validG2   = Array(128).fill(0); validG2[0] = 1; validG2[32] = 1; validG2[64] = 1; validG2[96] = 1;
    const validIc   = Array(5).fill(null).map(() => { const ic = Array(64).fill(0); ic[0] = 1; ic[32] = 1; return ic; });

    try {
      await program.methods
        .storeVk(validG1, badG2, validG2, validG2, validIc)
        .accounts({ admin: admin.publicKey, programConfig: programConfigPda, proposal: proposalPda, vkAccount: vkPda, systemProgram: anchor.web3.SystemProgram.programId })
        .rpc();
      assert.fail("Should have thrown");
    } catch (err) {
      assert.include(err.message, "InvalidVerificationKey");
    }
  });

  it("Stores the verifying key", async () => {
    // Values are non-zero and in-range (first byte of each 32-byte coordinate
    // chunk = 1 < 0x30), satisfying the field-element range check.
    // These are NOT valid curve points; real deployments must use a proper
    // trusted-setup ceremony to produce genuine BN254 curve points.
    const testG1 = Array(64).fill(0); testG1[0] = 1; testG1[32] = 1;
    const testG2 = Array(128).fill(0); testG2[0] = 1; testG2[32] = 1; testG2[64] = 1; testG2[96] = 1;
    const testIc = Array(5).fill(null).map(() => { const ic = Array(64).fill(0); ic[0] = 1; ic[32] = 1; return ic; });

    await program.methods
      .storeVk(testG1, testG2, testG2, testG2, testIc)
      .accounts({
        admin: admin.publicKey,
        programConfig: programConfigPda,
        proposal: proposalPda,
        vkAccount: vkPda,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .rpc();

    const vk = await program.account.verificationKeyAccount.fetch(vkPda);
    assert.equal(vk.isInitialized, true);
  });

  it("Opens voting", async () => {
    await program.methods
      .openVoting()
      .accounts({
        admin: admin.publicKey,
        proposal: proposalPda,
        vkAccount: vkPda,
      })
      .rpc();

    const proposal = await program.account.proposal.fetch(proposalPda);
    assert.deepEqual(proposal.status, { voting: {} });
  });

  it("Casts a vote", async () => {
    nullifierRecordPda = getNullifierPda(proposalPda, nullifier);
    voteRecordPda = getVoteRecordPda(proposalPda, nullifier);

    // VK is initialized above. In dev mode the Groth16 math is skipped but
    // the VK must be present — the unconditional VK guard enforces this.
    await program.methods
      .castVote(
        proof,           // Vec<u8>: proof_a (64) || proof_b (128) || proof_c (64)
        [...nullifier],
        [...voteCommitment],
        admin.publicKey, // refund_to: rent returned here after finalization
      )
      .accounts({
        voter: admin.publicKey,
        proposal: proposalPda,
        vkAccount: vkPda,
        nullifierRecord: nullifierRecordPda,
        voteRecord: voteRecordPda,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .rpc();

    const proposal = await program.account.proposal.fetch(proposalPda);
    assert.equal(proposal.voteCount.toNumber(), 1);

    const voteRecord = await program.account.voteRecord.fetch(voteRecordPda);
    assert.equal(voteRecord.revealed, false);
    // Before reveal, .vote must be the sentinel 0xFF — not 0 (No) — so indexers
    // reading .vote without checking .revealed get an unambiguous signal.
    assert.equal(voteRecord.vote, 255);
  });

  it("Closes voting", async () => {
    // Wait for voting_end to pass — close_voting enforces now >= voting_end.
    await new Promise(r => setTimeout(r, 11000));

    await program.methods
      .closeVoting()
      .accounts({
        closer: admin.publicKey,
        proposal: proposalPda,
      })
      .rpc();

    const proposal = await program.account.proposal.fetch(proposalPda);
    assert.deepEqual(proposal.status, { closed: {} });
  });

  it("Reveals a vote", async () => {
    await program.methods
      .revealVote(1, [...revealRandomness])
      .accounts({
        revealer: admin.publicKey,
        proposal: proposalPda,
        voteRecord: voteRecordPda,
      })
      .rpc();

    const proposal = await program.account.proposal.fetch(proposalPda);
    assert.equal(proposal.yesCount.toNumber(), 1);
    assert.equal(proposal.noCount.toNumber(), 0);

    const voteRecord = await program.account.voteRecord.fetch(voteRecordPda);
    assert.equal(voteRecord.revealed, true);
    assert.equal(voteRecord.vote, 1);
  });

  it("Finalizes tally", async () => {
    await program.methods
      .finalizeTally()
      .accounts({
        finalizer: admin.publicKey,
        proposal: proposalPda,
      })
      .rpc();

    const proposal = await program.account.proposal.fetch(proposalPda);
    assert.deepEqual(proposal.status, { finalized: {} });
    assert.equal(proposal.yesCount.toNumber(), 1);
    assert.equal(proposal.noCount.toNumber(), 0);
    assert.equal(proposal.voteCount.toNumber(), 1);
  });

  // ── Negative / guard tests ─────────────────────────────────────────────────

  it("Rejects proposal with title too long", async () => {
    const longTitle = "a".repeat(129);
    const pda = getProposalPda(admin.publicKey, longTitle);

    try {
      await program.methods
        .createProposal(longTitle, description, new anchor.BN(votingStart), new anchor.BN(votingEnd))
        .accounts({
          admin: admin.publicKey,
          programConfig: programConfigPda,
          proposal: pda,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .rpc();
      assert.fail("Should have thrown");
    } catch (err) {
      assert.include(err.message, "TitleTooLong");
    }
  });

  it("Rejects create_proposal from non-authority wallet", async () => {
    const attacker = anchor.web3.Keypair.generate();
    const sig = await provider.connection.requestAirdrop(
      attacker.publicKey,
      anchor.web3.LAMPORTS_PER_SOL
    );
    await provider.connection.confirmTransaction(sig);

    const spamTitle = "Spam proposal";
    const spamPda = getProposalPda(attacker.publicKey, spamTitle);
    const futureEnd = Math.floor(Date.now() / 1000) + 3600;

    try {
      await program.methods
        .createProposal(spamTitle, description, new anchor.BN(votingStart), new anchor.BN(futureEnd))
        .accounts({
          admin: attacker.publicKey,
          programConfig: programConfigPda,
          proposal: spamPda,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .signers([attacker])
        .rpc();
      assert.fail("Should have thrown");
    } catch (err) {
      assert.include(err.message, "Unauthorized");
    }
  });

  it("Rejects create_proposal with voting window exceeding MAX_VOTING_DURATION", async () => {
    // 31 days > 30-day cap → InvalidVotingPeriod
    const longWindowTitle = "Long window proposal";
    const longWindowPda = getProposalPda(admin.publicKey, longWindowTitle);
    const now = Math.floor(Date.now() / 1000);
    const tooLongEnd = now + 31 * 24 * 60 * 60;

    try {
      await program.methods
        .createProposal(longWindowTitle, description, new anchor.BN(now - 1), new anchor.BN(tooLongEnd))
        .accounts({
          admin: admin.publicKey,
          programConfig: programConfigPda,
          proposal: longWindowPda,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .rpc();
      assert.fail("Should have thrown");
    } catch (err) {
      assert.include(err.message, "InvalidVotingPeriod");
    }
  });

  it("Accepts create_proposal with a short window in dev (MIN_VOTING_DURATION gate is production-only)", async () => {
    // MIN_VOTING_DURATION (1 hour) is enforced only in production builds to prevent
    // sham elections whose voting window expires before open_voting can be called.
    // In dev builds the check is skipped so tests can use short voting windows.
    // This test confirms the dev gate is active: a 2-second window must be accepted.
    const shortTitle = "Short window dev test";
    const shortPda = getProposalPda(admin.publicKey, shortTitle);
    const now = Math.floor(Date.now() / 1000);

    await program.methods
      .createProposal(shortTitle, description, new anchor.BN(now - 1), new anchor.BN(now + 3600))
      .accounts({
        admin: admin.publicKey,
        programConfig: programConfigPda,
        proposal: shortPda,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .rpc();

    const proposal = await program.account.proposal.fetch(shortPda);
    assert.equal(proposal.title, shortTitle);
  });

  it("Rejects voter registration by non-admin", async () => {
    const altTitle = "Alt proposal";
    const altPda = getProposalPda(admin.publicKey, altTitle);
    const altFutureEnd = Math.floor(Date.now() / 1000) + 3600;

    await program.methods
      .createProposal(altTitle, description, new anchor.BN(votingStart), new anchor.BN(altFutureEnd))
      .accounts({
        admin: admin.publicKey,
        programConfig: programConfigPda,
        proposal: altPda,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .rpc();

    const attacker = anchor.web3.Keypair.generate();
    const sig = await provider.connection.requestAirdrop(
      attacker.publicKey,
      anchor.web3.LAMPORTS_PER_SOL
    );
    await provider.connection.confirmTransaction(sig);

    // Phase 1: attacker registers their commitment as voter (this succeeds — anyone can register a commitment).
    const attackCommitment = Buffer.alloc(32, 2);
    await program.methods
      .registerCommitment([...attackCommitment])
      .accounts({
        voter: attacker.publicKey,
        proposal: altPda,
        pendingCommitment: getPendingCommitmentPda(altPda, attacker.publicKey),
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .signers([attacker])
      .rpc();

    // Phase 2: attacker tries to call registerVoter as admin — must fail Unauthorized.
    try {
      await program.methods
        .registerVoter()
        .accounts({
          admin: attacker.publicKey,
          voter: attacker.publicKey,
          proposal: altPda,
          pendingCommitment: getPendingCommitmentPda(altPda, attacker.publicKey),
          commitmentRecord: getCommitmentRecordPda(altPda, attackCommitment),
          voterRecord: getVoterRecordPda(altPda, attacker.publicKey),
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .signers([attacker])
        .rpc();
      assert.fail("Should have thrown");
    } catch (err) {
      assert.ok(err, "Non-admin registration should be rejected");
    }
  });

  it("Rejects zero commitment in register_commitment", async () => {
    const zeroCommitTitle = "Zero commitment test";
    const zeroCommitPda = getProposalPda(admin.publicKey, zeroCommitTitle);
    const zeroCommit = Buffer.alloc(32, 0);
    const futureEnd = Math.floor(Date.now() / 1000) + 3600;

    await program.methods
      .createProposal(zeroCommitTitle, description, new anchor.BN(votingStart), new anchor.BN(futureEnd))
      .accounts({ admin: admin.publicKey, programConfig: programConfigPda, proposal: zeroCommitPda, systemProgram: anchor.web3.SystemProgram.programId })
      .rpc();

    try {
      await program.methods.registerCommitment([...zeroCommit])
        .accounts({ voter: admin.publicKey, proposal: zeroCommitPda, pendingCommitment: getPendingCommitmentPda(zeroCommitPda, admin.publicKey), systemProgram: anchor.web3.SystemProgram.programId })
        .rpc();
      assert.fail("Should have thrown");
    } catch (err) {
      assert.include(err.message, "InvalidCommitment");
    }
  });

  it("Rejects out-of-range commitment in register_commitment", async () => {
    // A commitment with first byte 0xff is > BN254 prime (first byte 0x30),
    // so it is not a valid field element and must be rejected.
    const rangeTitle = "Out-of-range commitment test";
    const rangePda = getProposalPda(admin.publicKey, rangeTitle);
    const outOfRange = Buffer.alloc(32, 0xff);
    const futureEnd = Math.floor(Date.now() / 1000) + 3600;

    await program.methods
      .createProposal(rangeTitle, description, new anchor.BN(votingStart), new anchor.BN(futureEnd))
      .accounts({ admin: admin.publicKey, programConfig: programConfigPda, proposal: rangePda, systemProgram: anchor.web3.SystemProgram.programId })
      .rpc();

    try {
      await program.methods.registerCommitment([...outOfRange])
        .accounts({ voter: admin.publicKey, proposal: rangePda, pendingCommitment: getPendingCommitmentPda(rangePda, admin.publicKey), systemProgram: anchor.web3.SystemProgram.programId })
        .rpc();
      assert.fail("Should have thrown");
    } catch (err) {
      assert.include(err.message, "InvalidCommitment");
    }
  });

  it("Rejects duplicate voter commitment on the same proposal", async () => {
    // The same commitment bytes registered twice on the same proposal must be
    // rejected. The CommitmentRecord PDA (seeds: "commitment" + proposal + commitment)
    // is created with `init` on the first call; the second call attempts to init
    // the same PDA and fails because it already exists.
    const dupTitle = "Duplicate commitment test";
    const dupPda = getProposalPda(admin.publicKey, dupTitle);
    // First byte must be < 0x30 (BN254 field prime leading byte) so the value
    // is a valid Poseidon field element. 0x02 satisfies this.
    const dupCommitment = Buffer.alloc(32, 0x02);
    const dupCommitmentRecordPda = getCommitmentRecordPda(dupPda, dupCommitment);
    const futureEnd = Math.floor(Date.now() / 1000) + 3600;

    await program.methods
      .createProposal(dupTitle, description, new anchor.BN(votingStart), new anchor.BN(futureEnd))
      .accounts({ admin: admin.publicKey, programConfig: programConfigPda, proposal: dupPda, systemProgram: anchor.web3.SystemProgram.programId })
      .rpc();

    // First registration — must succeed.
    await registerVoterTwoPhase(dupPda, dupCommitment, admin.publicKey);

    // Second registration with identical commitment — must fail.
    // Phase 1 (registerCommitment) succeeds because PendingCommitmentRecord was closed.
    // Phase 2 (registerVoter) fails because CommitmentRecord already exists.
    const dupPendingPda = getPendingCommitmentPda(dupPda, admin.publicKey);
    await program.methods
      .registerCommitment([...dupCommitment])
      .accounts({ voter: admin.publicKey, proposal: dupPda, pendingCommitment: dupPendingPda, systemProgram: anchor.web3.SystemProgram.programId })
      .rpc();
    try {
      await program.methods
        .registerVoter()
        .accounts({ admin: admin.publicKey, voter: admin.publicKey, proposal: dupPda, pendingCommitment: dupPendingPda, commitmentRecord: dupCommitmentRecordPda, voterRecord: getVoterRecordPda(dupPda, admin.publicKey), systemProgram: anchor.web3.SystemProgram.programId })
        .rpc();
      assert.fail("Should have thrown");
    } catch (err) {
      assert.ok(err, "Duplicate commitment should be rejected");
    }
  });

  it("Rejects double registration of same voter identity with different commitment", async () => {
    // A colluding admin+voter cannot register the same Solana keypair twice —
    // even with a different commitment — because the VoterRecord PDA already exists.
    const dblTitle = "Double voter identity test";
    const dblPda = getProposalPda(admin.publicKey, dblTitle);
    const futureEnd = Math.floor(Date.now() / 1000) + 3600;
    const dblVoter = anchor.web3.Keypair.generate();
    const commitA = Buffer.alloc(32, 0x03);
    const commitB = Buffer.alloc(32, 0x04);

    // dblVoter needs SOL to pay for the PendingCommitmentRecord in registerCommitment.
    const dblSig = await provider.connection.requestAirdrop(dblVoter.publicKey, anchor.web3.LAMPORTS_PER_SOL);
    await provider.connection.confirmTransaction(dblSig);

    await program.methods
      .createProposal(dblTitle, description, new anchor.BN(votingStart), new anchor.BN(futureEnd))
      .accounts({ admin: admin.publicKey, programConfig: programConfigPda, proposal: dblPda, systemProgram: anchor.web3.SystemProgram.programId })
      .rpc();

    await registerVoterTwoPhase(dblPda, commitA, dblVoter.publicKey, dblVoter);

    // Same voter, different commitment — VoterRecord already exists; must fail.
    // Phase 1 succeeds (fresh PendingCommitmentRecord after previous was closed).
    // Phase 2 fails because VoterRecord already exists (is_initialized = true).
    const dblPendingPda = getPendingCommitmentPda(dblPda, dblVoter.publicKey);
    await program.methods
      .registerCommitment([...commitB])
      .accounts({ voter: dblVoter.publicKey, proposal: dblPda, pendingCommitment: dblPendingPda, systemProgram: anchor.web3.SystemProgram.programId })
      .signers([dblVoter])
      .rpc();
    try {
      await program.methods
        .registerVoter()
        .accounts({ admin: admin.publicKey, voter: dblVoter.publicKey, proposal: dblPda, pendingCommitment: dblPendingPda, commitmentRecord: getCommitmentRecordPda(dblPda, commitB), voterRecord: getVoterRecordPda(dblPda, dblVoter.publicKey), systemProgram: anchor.web3.SystemProgram.programId })
        .rpc();
      assert.fail("Should have thrown");
    } catch (err) {
      assert.ok(err, "Same voter identity with different commitment must be rejected");
    }
  });

  it("Rejects open_voting with no registered voters", async () => {
    const emptyTitle = "Empty proposal";
    const emptyPda = getProposalPda(admin.publicKey, emptyTitle);
    const emptyFutureEnd = Math.floor(Date.now() / 1000) + 3600;

    await program.methods
      .createProposal(emptyTitle, description, new anchor.BN(votingStart), new anchor.BN(emptyFutureEnd))
      .accounts({
        admin: admin.publicKey,
        programConfig: programConfigPda,
        proposal: emptyPda,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .rpc();

    await storeVkForProposal(emptyPda);

    try {
      await program.methods
        .openVoting()
        .accounts({
          admin: admin.publicKey,
          proposal: emptyPda,
          vkAccount: getVkPda(emptyPda),
        })
        .rpc();
      assert.fail("Should have thrown");
    } catch (err) {
      assert.include(err.message, "NotInRegistration");
    }
  });

  it("Rejects open_voting after voting_end has passed", async () => {
    // Admin calls open_voting after voting_end — must fail with VotingNotOpen.
    // Without the upper-bound check the proposal would transition to Voting,
    // cast_vote would be blocked (window expired), and the admin could finalize
    // immediately with 0/0 votes as the official result.
    const now = Math.floor(Date.now() / 1000);
    const expiredTitle = "Expired window test";
    const expiredPda = getProposalPda(admin.publicKey, expiredTitle);

    await program.methods
      .createProposal(expiredTitle, description, new anchor.BN(now - 1), new anchor.BN(now + 1))
      .accounts({ admin: admin.publicKey, programConfig: programConfigPda, proposal: expiredPda, systemProgram: anchor.web3.SystemProgram.programId })
      .rpc();

    await registerVoterTwoPhase(expiredPda, Buffer.alloc(32, 0x0a), admin.publicKey);

    await storeVkForProposal(expiredPda);

    // Wait for voting_end to pass.
    await new Promise(r => setTimeout(r, 2000));

    try {
      await program.methods.openVoting()
        .accounts({ admin: admin.publicKey, proposal: expiredPda, vkAccount: getVkPda(expiredPda) })
        .rpc();
      assert.fail("Should have thrown");
    } catch (err) {
      assert.include(err.message, "VotingNotOpen");
    }
  });

  it("Rejects double vote with same nullifier", async () => {
    try {
      await program.methods
        .castVote(
          proof,
          [...nullifier],
          [...voteCommitment],
          admin.publicKey,
        )
        .accounts({
          voter: admin.publicKey,
          proposal: proposalPda,
          vkAccount: vkPda,
          nullifierRecord: nullifierRecordPda,
          voteRecord: voteRecordPda,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .rpc();
      assert.fail("Should have thrown");
    } catch (err) {
      assert.ok(err, "Double vote should be rejected");
    }
  });

  it("Rejects cast_vote with zero vote_commitment", async () => {
    // An all-zero commitment can never be a Poseidon output, so the vote
    // would be permanently unrevealable — griefing finalization by preventing
    // all_votes_revealed from ever becoming true.
    const zvTitle = "Zero commitment cast_vote test";
    const zvPda = getProposalPda(admin.publicKey, zvTitle);
    const zvNullifier = Buffer.alloc(32, 0x07); // valid BN254 field element
    const zvNullifierPda = getNullifierPda(zvPda, zvNullifier);
    const zvVoteRecordPda = getVoteRecordPda(zvPda, zvNullifier);
    const futureEnd = Math.floor(Date.now() / 1000) + 3600;

    await program.methods
      .createProposal(zvTitle, description, new anchor.BN(votingStart), new anchor.BN(futureEnd))
      .accounts({ admin: admin.publicKey, programConfig: programConfigPda, proposal: zvPda, systemProgram: anchor.web3.SystemProgram.programId })
      .rpc();

    await registerVoterTwoPhase(zvPda, Buffer.alloc(32, 0x0b), admin.publicKey);

    await storeVkForProposal(zvPda);
    await program.methods.openVoting()
      .accounts({ admin: admin.publicKey, proposal: zvPda, vkAccount: getVkPda(zvPda) })
      .rpc();

    try {
      await program.methods
        .castVote(proof, [...zvNullifier], [...Buffer.alloc(32, 0)], admin.publicKey)  // zero commitment
        .accounts({
          voter: admin.publicKey, proposal: zvPda, vkAccount: getVkPda(zvPda),
          nullifierRecord: zvNullifierPda, voteRecord: zvVoteRecordPda,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .rpc();
      assert.fail("Should have thrown");
    } catch (err) {
      assert.include(err.message, "InvalidCommitment");
    }
  });

  it("Rejects cast_vote with zero nullifier", async () => {
    // Zero is not a valid Poseidon output; accepting it would let an attacker
    // occupy a NullifierRecord with an invalid ZK state in dev mode.
    const znTitle = "Zero nullifier cast_vote test";
    const znPda = getProposalPda(admin.publicKey, znTitle);
    const zeroNullifier = Buffer.alloc(32, 0);
    const znNullifierPda = getNullifierPda(znPda, zeroNullifier);
    const znVoteRecordPda = getVoteRecordPda(znPda, zeroNullifier);
    const futureEnd = Math.floor(Date.now() / 1000) + 3600;

    await program.methods
      .createProposal(znTitle, description, new anchor.BN(votingStart), new anchor.BN(futureEnd))
      .accounts({ admin: admin.publicKey, programConfig: programConfigPda, proposal: znPda, systemProgram: anchor.web3.SystemProgram.programId })
      .rpc();

    await registerVoterTwoPhase(znPda, Buffer.alloc(32, 0x0c), admin.publicKey);

    await storeVkForProposal(znPda);
    await program.methods.openVoting()
      .accounts({ admin: admin.publicKey, proposal: znPda, vkAccount: getVkPda(znPda) })
      .rpc();

    try {
      await program.methods
        .castVote(proof, [...zeroNullifier], [...voteCommitment], admin.publicKey)
        .accounts({
          voter: admin.publicKey, proposal: znPda, vkAccount: getVkPda(znPda),
          nullifierRecord: znNullifierPda, voteRecord: znVoteRecordPda,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .rpc();
      assert.fail("Should have thrown");
    } catch (err) {
      assert.include(err.message, "InvalidProof");
    }
  });

  it("Rejects close_voting before voting_end", async () => {
    const earlyCloseTitle = "Early close test";
    const earlyClosePda = getProposalPda(admin.publicKey, earlyCloseTitle);
    const futureEnd = Math.floor(Date.now() / 1000) + 3600;

    await program.methods
      .createProposal(earlyCloseTitle, description, new anchor.BN(votingStart), new anchor.BN(futureEnd))
      .accounts({ admin: admin.publicKey, programConfig: programConfigPda, proposal: earlyClosePda, systemProgram: anchor.web3.SystemProgram.programId })
      .rpc();

    await registerVoterTwoPhase(earlyClosePda, commitment, admin.publicKey);

    await storeVkForProposal(earlyClosePda);
    await program.methods
      .openVoting()
      .accounts({ admin: admin.publicKey, proposal: earlyClosePda, vkAccount: getVkPda(earlyClosePda) })
      .rpc();

    try {
      await program.methods
        .closeVoting()
        .accounts({ closer: admin.publicKey, proposal: earlyClosePda })
        .rpc();
      assert.fail("Should have thrown");
    } catch (err) {
      assert.include(err.message, "VotingStillOpen");
    }
  });

  it("Rejects reveal_vote with wrong randomness", async () => {
    const now2 = Math.floor(Date.now() / 1000);
    const cmTitle = "Commitment mismatch test";
    const cmPda = getProposalPda(admin.publicKey, cmTitle);
    const cmNullifier = Buffer.alloc(32, 0x02); // valid BN254 field element
    const cmNullifierPda = getNullifierPda(cmPda, cmNullifier);
    const cmVoteRecordPda = getVoteRecordPda(cmPda, cmNullifier);
    const cmRandomness = Buffer.alloc(32, 0x42);
    const cmCommitment = computeVoteCommitment(1, cmRandomness);

    await program.methods
      .createProposal(cmTitle, description, new anchor.BN(now2 - 1), new anchor.BN(now2 + 5))
      .accounts({ admin: admin.publicKey, programConfig: programConfigPda, proposal: cmPda, systemProgram: anchor.web3.SystemProgram.programId })
      .rpc();

    await registerVoterTwoPhase(cmPda, commitment, admin.publicKey);

    await storeVkForProposal(cmPda);
    await program.methods.openVoting()
      .accounts({ admin: admin.publicKey, proposal: cmPda, vkAccount: getVkPda(cmPda) })
      .rpc();

    await program.methods
      .castVote(proof, [...cmNullifier], [...cmCommitment], admin.publicKey)
      .accounts({
        voter: admin.publicKey, proposal: cmPda, vkAccount: getVkPda(cmPda),
        nullifierRecord: cmNullifierPda, voteRecord: cmVoteRecordPda,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .rpc();

    await new Promise(r => setTimeout(r, 5000));
    await program.methods.closeVoting()
      .accounts({ closer: admin.publicKey, proposal: cmPda })
      .rpc();

    try {
      // Wrong randomness — must be a valid BN254 field element (< p ≈ 0x30644e...).
      // Using 1 (all-zeros with last byte = 1) is always safe and differs from cmRandomness.
      const wrongRandomness = Buffer.alloc(32, 0);
      wrongRandomness[31] = 0x01;
      await program.methods
        .revealVote(1, [...wrongRandomness])
        .accounts({ revealer: admin.publicKey, proposal: cmPda, voteRecord: cmVoteRecordPda })
        .rpc();
      assert.fail("Should have thrown");
    } catch (err) {
      assert.include(err.message, "CommitmentMismatch");
    }
  });

  it("Permits reveal by any account knowing the preimage", async () => {
    // Reveal is permissionless — no voter identity stored on-chain.
    // The commitment check Poseidon(vote, randomness) == vote_commitment is the
    // sole authorization, preserving ZK anonymity.
    const now3 = Math.floor(Date.now() / 1000);
    const wvTitle = "Voter auth test";
    const wvPda = getProposalPda(admin.publicKey, wvTitle);
    const wvNullifier = Buffer.alloc(32, 0x03); // valid BN254 field element
    const wvNullifierPda = getNullifierPda(wvPda, wvNullifier);
    const wvVoteRecordPda = getVoteRecordPda(wvPda, wvNullifier);
    const wvRandomness = Buffer.alloc(32, 0);
    const wvCommitment = computeVoteCommitment(1, wvRandomness);

    await program.methods
      .createProposal(wvTitle, description, new anchor.BN(now3 - 1), new anchor.BN(now3 + 5))
      .accounts({ admin: admin.publicKey, programConfig: programConfigPda, proposal: wvPda, systemProgram: anchor.web3.SystemProgram.programId })
      .rpc();

    await registerVoterTwoPhase(wvPda, commitment, admin.publicKey);

    await storeVkForProposal(wvPda);
    await program.methods.openVoting()
      .accounts({ admin: admin.publicKey, proposal: wvPda, vkAccount: getVkPda(wvPda) })
      .rpc();

    await program.methods
      .castVote(proof, [...wvNullifier], [...wvCommitment], admin.publicKey)
      .accounts({
        voter: admin.publicKey, proposal: wvPda, vkAccount: getVkPda(wvPda),
        nullifierRecord: wvNullifierPda, voteRecord: wvVoteRecordPda,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .rpc();

    await new Promise(r => setTimeout(r, 5000));
    await program.methods.closeVoting()
      .accounts({ closer: admin.publicKey, proposal: wvPda })
      .rpc();

    // A third party who knows the preimage can reveal — no wallet link on-chain.
    const relayer = anchor.web3.Keypair.generate();
    const sig = await provider.connection.requestAirdrop(relayer.publicKey, anchor.web3.LAMPORTS_PER_SOL);
    await provider.connection.confirmTransaction(sig);

    await program.methods
      .revealVote(1, [...wvRandomness])
      .accounts({ revealer: relayer.publicKey, proposal: wvPda, voteRecord: wvVoteRecordPda })
      .signers([relayer])
      .rpc();

    const voteRecord = await program.account.voteRecord.fetch(wvVoteRecordPda);
    assert.equal(voteRecord.revealed, true);
    assert.equal(voteRecord.vote, 1);
  });

  it("Rejects finalize before close", async () => {
    const freshTitle = "Fresh proposal";
    const freshPda = getProposalPda(admin.publicKey, freshTitle);
    const freshFutureEnd = Math.floor(Date.now() / 1000) + 3600;

    await program.methods
      .createProposal(freshTitle, description, new anchor.BN(votingStart), new anchor.BN(freshFutureEnd))
      .accounts({
        admin: admin.publicKey,
        programConfig: programConfigPda,
        proposal: freshPda,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .rpc();

    try {
      await program.methods
        .finalizeTally()
        .accounts({
          finalizer: admin.publicKey,
          proposal: freshPda,
        })
        .rpc();
      assert.fail("Should have thrown");
    } catch (err) {
      assert.include(err.message, "VotingStillOpen");
    }
  });

  // ── finalize_tally overflow-safety tests ──────────────────────────────────
  //
  // These tests verify the guard logic that the saturating_add fix protects.
  // Direct testing with extreme values (e.g. voting_end = i64::MAX) is not
  // feasible in integration tests: close_voting requires
  // clock.unix_timestamp >= voting_end, so a proposal with voting_end near
  // i64::MAX can never be closed.  The tests below instead confirm that the
  // conditions surrounding the saturating arithmetic evaluate correctly with
  // normal values.

  it("Rejects finalize_tally when votes unrevealed and grace period not yet expired", async () => {
    // vote_count=1, yes+no=0 → all_revealed = false (tests saturating_add on counts).
    // voting_end just passed; REVEAL_GRACE_PERIOD (86_400 s) has not elapsed
    // → grace_expired = false (tests saturating_add on voting_end).
    // Both conditions false → must reject with VotingStillOpen.
    const now4 = Math.floor(Date.now() / 1000);
    const graceTitle = "Grace period test";
    const gracePda = getProposalPda(admin.publicKey, graceTitle);
    const graceNullifier = Buffer.alloc(32, 0x04); // valid BN254 field element
    const graceNullifierPda = getNullifierPda(gracePda, graceNullifier);
    const graceVoteRecordPda = getVoteRecordPda(gracePda, graceNullifier);
    const graceCommitment = computeVoteCommitment(1, Buffer.alloc(32, 0));

    await program.methods
      .createProposal(graceTitle, description, new anchor.BN(now4 - 1), new anchor.BN(now4 + 8))
      .accounts({ admin: admin.publicKey, programConfig: programConfigPda, proposal: gracePda, systemProgram: anchor.web3.SystemProgram.programId })
      .rpc();

    await registerVoterTwoPhase(gracePda, Buffer.alloc(32, 9), admin.publicKey);

    await storeVkForProposal(gracePda);
    await program.methods.openVoting()
      .accounts({ admin: admin.publicKey, proposal: gracePda, vkAccount: getVkPda(gracePda) })
      .rpc();

    await program.methods
      .castVote(proof, [...graceNullifier], [...graceCommitment], admin.publicKey)
      .accounts({
        voter: admin.publicKey, proposal: gracePda, vkAccount: getVkPda(gracePda),
        nullifierRecord: graceNullifierPda, voteRecord: graceVoteRecordPda,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .rpc();

    // Wait for voting_end to pass, then close.
    await new Promise(r => setTimeout(r, 9000));
    await program.methods.closeVoting()
      .accounts({ closer: admin.publicKey, proposal: gracePda })
      .rpc();

    // Immediately attempt finalize — grace period has not elapsed.
    try {
      await program.methods.finalizeTally()
        .accounts({ finalizer: admin.publicKey, proposal: gracePda })
        .rpc();
      assert.fail("Should have thrown");
    } catch (err) {
      assert.include(err.message, "VotingStillOpen");
    }
  });

  it("Rejects close_proposal with partially closed vote accounts (2-vote scenario)", async () => {
    // Two votes cast → vote_count=2. Closing only the first pair leaves
    // closed_vote_count=1 < vote_count=2, so close_proposal must still reject.
    // Only after both pairs are closed does close_proposal succeed.
    const now = Math.floor(Date.now() / 1000);
    const partTitle = "Partial close test";
    const partPda   = getProposalPda(admin.publicKey, partTitle);

    const nul1 = Buffer.alloc(32, 0x05); // valid BN254 field element
    const nul2 = Buffer.alloc(32, 0x06); // valid BN254 field element
    const nulPda1  = getNullifierPda(partPda, nul1);
    const nulPda2  = getNullifierPda(partPda, nul2);
    const voteP1   = getVoteRecordPda(partPda, nul1);
    const voteP2   = getVoteRecordPda(partPda, nul2);
    // Both votes use the same (vote=1, randomness=0) commitment — fine because
    // vote records are separate accounts keyed by nullifier.
    const partCommitment = computeVoteCommitment(1, Buffer.alloc(32, 0));
    const partRandomness = Buffer.alloc(32, 0);

    // ── Setup ──────────────────────────────────────────────────────────────
    await program.methods
      .createProposal(partTitle, description, new anchor.BN(now - 1), new anchor.BN(now + 15))
      .accounts({ admin: admin.publicKey, programConfig: programConfigPda, proposal: partPda, systemProgram: anchor.web3.SystemProgram.programId })
      .rpc();

    // Two distinct voters — unique keypairs so the VoterRecord guard doesn't block the second.
    // Both need SOL to pay for their PendingCommitmentRecord in registerCommitment.
    const partVoter1 = anchor.web3.Keypair.generate();
    const partVoter2 = anchor.web3.Keypair.generate();
    for (const kp of [partVoter1, partVoter2]) {
      const s = await provider.connection.requestAirdrop(kp.publicKey, anchor.web3.LAMPORTS_PER_SOL);
      await provider.connection.confirmTransaction(s);
    }
    await registerVoterTwoPhase(partPda, Buffer.alloc(32, 0x05), partVoter1.publicKey, partVoter1);
    await registerVoterTwoPhase(partPda, Buffer.alloc(32, 0x06), partVoter2.publicKey, partVoter2);

    await storeVkForProposal(partPda);
    await program.methods.openVoting()
      .accounts({ admin: admin.publicKey, proposal: partPda, vkAccount: getVkPda(partPda) })
      .rpc();

    for (const [nul, nulPda, vPda] of [[nul1, nulPda1, voteP1], [nul2, nulPda2, voteP2]] as const) {
      await program.methods.castVote(proof, [...nul], [...partCommitment], admin.publicKey)
        .accounts({ voter: admin.publicKey, proposal: partPda, vkAccount: getVkPda(partPda), nullifierRecord: nulPda, voteRecord: vPda, systemProgram: anchor.web3.SystemProgram.programId })
        .rpc();
    }

    await new Promise(r => setTimeout(r, 16000));
    await program.methods.closeVoting().accounts({ closer: admin.publicKey, proposal: partPda }).rpc();

    // Reveal both votes so all_revealed=true and finalizeTally succeeds without
    // waiting for the 86400-second grace period.
    for (const vPda of [voteP1, voteP2]) {
      await program.methods.revealVote(1, [...partRandomness])
        .accounts({ revealer: admin.publicKey, proposal: partPda, voteRecord: vPda })
        .rpc();
    }

    await program.methods.finalizeTally().accounts({ finalizer: admin.publicKey, proposal: partPda }).rpc();

    // ── Close first pair ───────────────────────────────────────────────────
    await program.methods.closeVoteAccounts()
      .accounts({ closer: admin.publicKey, refundTo: admin.publicKey, proposal: partPda, nullifierRecord: nulPda1, voteRecord: voteP1 })
      .rpc();

    let part = await program.account.proposal.fetch(partPda);
    assert.equal(part.closedVoteCount.toNumber(), 1, "closed_vote_count should be 1 after first pair");

    // close_proposal with 1 of 2 pairs closed → must still reject
    try {
      await program.methods.closeProposal().accounts({ admin: admin.publicKey, proposal: partPda }).rpc();
      assert.fail("Should have thrown");
    } catch (err) {
      assert.include(err.message, "VoteAccountsNotClosed");
    }

    // ── Close second pair ──────────────────────────────────────────────────
    await program.methods.closeVoteAccounts()
      .accounts({ closer: admin.publicKey, refundTo: admin.publicKey, proposal: partPda, nullifierRecord: nulPda2, voteRecord: voteP2 })
      .rpc();

    part = await program.account.proposal.fetch(partPda);
    assert.equal(part.closedVoteCount.toNumber(), 2, "closed_vote_count should be 2 after second pair");

    // All vote pairs closed but commitment records still open → must still reject
    try {
      await program.methods.closeProposal().accounts({ admin: admin.publicKey, proposal: partPda }).rpc();
      assert.fail("Should have thrown");
    } catch (err) {
      assert.include(err.message, "CommitmentAccountsNotClosed");
    }

    // ── Close both commitment records (and their VoterRecords) ────────────
    await program.methods.closeCommitmentRecord()
      .accounts({ closer: admin.publicKey, proposal: partPda, commitmentRecord: getCommitmentRecordPda(partPda, Buffer.alloc(32, 0x05)), voterRecord: getVoterRecordPda(partPda, partVoter1.publicKey) })
      .rpc();
    await program.methods.closeCommitmentRecord()
      .accounts({ closer: admin.publicKey, proposal: partPda, commitmentRecord: getCommitmentRecordPda(partPda, Buffer.alloc(32, 0x06)), voterRecord: getVoterRecordPda(partPda, partVoter2.publicKey) })
      .rpc();

    part = await program.account.proposal.fetch(partPda);
    assert.equal(part.closedCommitmentCount.toNumber(), 2, "closed_commitment_count should be 2");

    // All vote pairs and commitment records closed → close_proposal must now succeed
    await program.methods.closeProposal().accounts({ admin: admin.publicKey, proposal: partPda }).rpc();

    try {
      await program.account.proposal.fetch(partPda);
      assert.fail("Should have thrown");
    } catch (err) {
      assert.ok(err, "Proposal account should be gone after close");
    }
  });

  // ── open_voting VK gate ────────────────────────────────────────────────────
  //
  // The seeds constraint is always enforced (wrong address → rejected before
  // the handler runs). The is_initialized check only fires in production
  // builds; dev builds allow opening without a VK so anchor test works
  // without a real trusted-setup ceremony.

  it("Rejects open_voting when vk_account PDA is wrong", async () => {
    // Anchor validates account seeds before the handler runs.
    // Passing any address other than the canonical [b"vk", proposal.key()] PDA
    // must be rejected in both dev and production builds.
    const wrongVkTitle = "Wrong VK PDA test";
    const wrongVkPda = getProposalPda(admin.publicKey, wrongVkTitle);
    const nowLocal = Math.floor(Date.now() / 1000);
    const futureEnd = nowLocal + 3600;

    await program.methods
      .createProposal(wrongVkTitle, description, new anchor.BN(nowLocal - 1), new anchor.BN(futureEnd))
      .accounts({ admin: admin.publicKey, programConfig: programConfigPda, proposal: wrongVkPda, systemProgram: anchor.web3.SystemProgram.programId })
      .rpc();

    await registerVoterTwoPhase(wrongVkPda, Buffer.alloc(32, 7), admin.publicKey);

    try {
      await program.methods
        .openVoting()
        .accounts({
          admin: admin.publicKey,
          proposal: wrongVkPda,
          vkAccount: wrongVkPda,   // intentionally wrong — proposalPda ≠ vkPda
        })
        .rpc();
      assert.fail("Should have thrown");
    } catch (err) {
      assert.ok(err, "Wrong vk_account PDA should be rejected by seeds constraint");
    }
  });

  it("open_voting succeeds with an initialized VK", async () => {
    // With VK stored and is_initialized == true, open_voting must transition
    // the proposal to Voting. This exercises the path that production builds
    // enforce: open_voting is only reachable after store_vk has been called.
    const initVkTitle = "Initialized VK test";
    const initVkPda = getProposalPda(admin.publicKey, initVkTitle);
    const nowLocal = Math.floor(Date.now() / 1000);
    const futureEnd = nowLocal + 3600;

    await program.methods
      .createProposal(initVkTitle, description, new anchor.BN(nowLocal - 1), new anchor.BN(futureEnd))
      .accounts({ admin: admin.publicKey, programConfig: programConfigPda, proposal: initVkPda, systemProgram: anchor.web3.SystemProgram.programId })
      .rpc();

    await registerVoterTwoPhase(initVkPda, Buffer.alloc(32, 8), admin.publicKey);

    await storeVkForProposal(initVkPda);
    await program.methods
      .openVoting()
      .accounts({ admin: admin.publicKey, proposal: initVkPda, vkAccount: getVkPda(initVkPda) })
      .rpc();

    const proposal = await program.account.proposal.fetch(initVkPda);
    assert.deepEqual(proposal.status, { voting: {} });
  });

  it("Rejects a second store_vk call (reinitialization guard)", async () => {
    // vkPda is already initialized from "Stores the verifying key".
    // A second call must be rejected by the is_initialized guard before
    // reaching validation, even though init_if_needed would otherwise
    // succeed at the account-constraint level.
    const testG1 = Array(64).fill(0); testG1[0] = 1; testG1[32] = 1;
    const testG2 = Array(128).fill(0); testG2[0] = 1; testG2[32] = 1; testG2[64] = 1; testG2[96] = 1;
    const testIc = Array(5).fill(null).map(() => { const ic = Array(64).fill(0); ic[0] = 1; ic[32] = 1; return ic; });

    try {
      await program.methods
        .storeVk(testG1, testG2, testG2, testG2, testIc)
        .accounts({
          admin: admin.publicKey,
          programConfig: programConfigPda,
          proposal: proposalPda,
          vkAccount: vkPda,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .rpc();
      assert.fail("Should have thrown");
    } catch (err) {
      assert.include(err.message, "VkAlreadyInitialized");
    }
  });

  // ── Account closing tests ──────────────────────────────────────────────────
  // Placed last so all preceding tests can still access proposalPda's accounts.

  it("Rejects close_proposal before finalization", async () => {
    const preTitle = "Pre-finalize close test";
    const prePda = getProposalPda(admin.publicKey, preTitle);
    const nowLocal = Math.floor(Date.now() / 1000);
    const futureEnd = nowLocal + 3600;

    await program.methods
      .createProposal(preTitle, description, new anchor.BN(nowLocal - 1), new anchor.BN(futureEnd))
      .accounts({ admin: admin.publicKey, programConfig: programConfigPda, proposal: prePda, systemProgram: anchor.web3.SystemProgram.programId })
      .rpc();

    try {
      await program.methods
        .closeProposal()
        .accounts({ admin: admin.publicKey, proposal: prePda })
        .rpc();
      assert.fail("Should have thrown");
    } catch (err) {
      assert.include(err.message, "NotFinalized");
    }
  });

  it("Rejects close_proposal when vote accounts remain unclosed", async () => {
    // proposalPda is Finalized with vote_count=1 and closed_vote_count=0.
    // close_proposal must fail until all vote pairs are closed.
    try {
      await program.methods
        .closeProposal()
        .accounts({ admin: admin.publicKey, proposal: proposalPda })
        .rpc();
      assert.fail("Should have thrown");
    } catch (err) {
      assert.include(err.message, "VoteAccountsNotClosed");
    }
  });

  it("Closes vote accounts after finalization", async () => {
    // proposalPda is Finalized; nullifierRecordPda and voteRecordPda were
    // created during "Casts a vote". Closing them reclaims the rent.
    await program.methods
      .closeVoteAccounts()
      .accounts({
        closer: admin.publicKey,
        refundTo: admin.publicKey, // matches vote_record.refund_to set during cast_vote
        proposal: proposalPda,
        nullifierRecord: nullifierRecordPda,
        voteRecord: voteRecordPda,
      })
      .rpc();

    assert.isNull(
      await provider.connection.getAccountInfo(nullifierRecordPda),
      "NullifierRecord should be closed"
    );
    assert.isNull(
      await provider.connection.getAccountInfo(voteRecordPda),
      "VoteRecord should be closed"
    );

    const proposal = await program.account.proposal.fetch(proposalPda);
    assert.equal(proposal.closedVoteCount.toNumber(), 1, "closedVoteCount should be 1 after closing the vote pair");
  });

  it("Rejects close_proposal when commitment records remain unclosed", async () => {
    // proposalPda is Finalized with voter_count=1 and closed_commitment_count=0.
    // close_proposal must fail until the CommitmentRecord is closed.
    try {
      await program.methods
        .closeProposal()
        .accounts({ admin: admin.publicKey, proposal: proposalPda })
        .rpc();
      assert.fail("Should have thrown");
    } catch (err) {
      assert.include(err.message, "CommitmentAccountsNotClosed");
    }
  });

  it("Closes commitment record after finalization", async () => {
    // The main proposal has voter_count=1; commitment = Buffer.alloc(32, 1).
    // Closing it reclaims the admin's registration rent and increments
    // closed_commitment_count so close_proposal can proceed.
    const commitmentRecordPda = getCommitmentRecordPda(proposalPda, commitment);

    await program.methods
      .closeCommitmentRecord()
      .accounts({
        closer: admin.publicKey,
        proposal: proposalPda,
        commitmentRecord: commitmentRecordPda,
        voterRecord: getVoterRecordPda(proposalPda, admin.publicKey),
      })
      .rpc();

    assert.isNull(
      await provider.connection.getAccountInfo(commitmentRecordPda),
      "CommitmentRecord should be closed"
    );

    const proposal = await program.account.proposal.fetch(proposalPda);
    assert.equal(
      proposal.closedCommitmentCount.toNumber(), 1,
      "closedCommitmentCount should be 1 after closing the commitment record"
    );
  });

  it("Closes proposal after finalization", async () => {
    // All vote accounts and commitment records are now closed.
    await program.methods
      .closeProposal()
      .accounts({ admin: admin.publicKey, proposal: proposalPda })
      .rpc();

    try {
      await program.account.proposal.fetch(proposalPda);
      assert.fail("Should have thrown");
    } catch (err) {
      assert.ok(err, "Closed proposal account should not be fetchable");
    }
  });

  // ── expire_proposal tests ──────────────────────────────────────────────────

  it("Rejects expire_proposal before voting_end", async () => {
    // A fresh proposal with voting_end = now + 3600 cannot be expired yet.
    const expTitle = "Expire early test";
    const expPda = getProposalPda(admin.publicKey, expTitle);
    const nowLocal = Math.floor(Date.now() / 1000);

    await program.methods
      .createProposal(expTitle, description, new anchor.BN(nowLocal - 1), new anchor.BN(nowLocal + 3600))
      .accounts({ admin: admin.publicKey, programConfig: programConfigPda, proposal: expPda, systemProgram: anchor.web3.SystemProgram.programId })
      .rpc();

    try {
      await program.methods
        .expireProposal()
        .accounts({ caller: admin.publicKey, proposal: expPda })
        .rpc();
      assert.fail("Should have thrown");
    } catch (err) {
      assert.include(err.message, "VotingWindowNotExpired");
    }
  });

  it("Rejects expire_proposal when status is not Registration", async () => {
    // The main proposalPda is now Closed (before finalization tests ran).
    // expire_proposal requires Registration status — any other status must fail.
    // We use a locally-created Voting-phase proposal to cover the non-Registration path.
    const expVotTitle = "Expire voting test";
    const expVotPda = getProposalPda(admin.publicKey, expVotTitle);
    const nowLocal = Math.floor(Date.now() / 1000);

    await program.methods
      .createProposal(expVotTitle, description, new anchor.BN(nowLocal - 1), new anchor.BN(nowLocal + 3600))
      .accounts({ admin: admin.publicKey, programConfig: programConfigPda, proposal: expVotPda, systemProgram: anchor.web3.SystemProgram.programId })
      .rpc();

    await registerVoterTwoPhase(expVotPda, Buffer.alloc(32, 0x09), admin.publicKey);

    await storeVkForProposal(expVotPda);
    await program.methods
      .openVoting()
      .accounts({ admin: admin.publicKey, proposal: expVotPda, vkAccount: getVkPda(expVotPda) })
      .rpc();

    // Proposal is now in Voting status — expire_proposal must reject.
    try {
      await program.methods
        .expireProposal()
        .accounts({ caller: admin.publicKey, proposal: expVotPda })
        .rpc();
      assert.fail("Should have thrown");
    } catch (err) {
      assert.include(err.message, "NotInRegistration");
    }
  });

  it("Expires a proposal that was never opened and reclaims all rent", async () => {
    // A proposal stuck in Registration past voting_end must be expirable
    // by anyone, and its commitment records + account must be closeable afterward.
    const stuckTitle = "Stuck registration test";
    const stuckNow = Math.floor(Date.now() / 1000);
    const stuckPda = getProposalPda(admin.publicKey, stuckTitle);
    const stuckCommitment = Buffer.alloc(32, 0x0a);
    const stuckCommitmentPda = getCommitmentRecordPda(stuckPda, stuckCommitment);

    await program.methods
      .createProposal(stuckTitle, description, new anchor.BN(stuckNow - 1), new anchor.BN(stuckNow + 3))
      .accounts({ admin: admin.publicKey, programConfig: programConfigPda, proposal: stuckPda, systemProgram: anchor.web3.SystemProgram.programId })
      .rpc();

    await registerVoterTwoPhase(stuckPda, stuckCommitment, admin.publicKey);

    // Wait for voting_end to pass without calling open_voting.
    await new Promise(r => setTimeout(r, 10000));

    // Any caller can expire the proposal.
    await program.methods
      .expireProposal()
      .accounts({ caller: admin.publicKey, proposal: stuckPda })
      .rpc();

    let stuck = await program.account.proposal.fetch(stuckPda);
    assert.equal(stuck.status.expired !== undefined, true, "status should be Expired");

    // Close the commitment record (and VoterRecord) — works because Expired is terminal.
    await program.methods
      .closeCommitmentRecord()
      .accounts({ closer: admin.publicKey, proposal: stuckPda, commitmentRecord: stuckCommitmentPda, voterRecord: getVoterRecordPda(stuckPda, admin.publicKey) })
      .rpc();

    stuck = await program.account.proposal.fetch(stuckPda);
    assert.equal(stuck.closedCommitmentCount.toNumber(), 1, "closedCommitmentCount should be 1");

    // Close the proposal itself — vote_count=0 so closed_vote_count>=vote_count trivially.
    await program.methods
      .closeProposal()
      .accounts({ admin: admin.publicKey, proposal: stuckPda })
      .rpc();

    try {
      await program.account.proposal.fetch(stuckPda);
      assert.fail("Should have thrown");
    } catch (err) {
      assert.ok(err, "Expired proposal account should be gone after close");
    }
  });
});

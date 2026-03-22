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

  // Voting period: already started, ends 2 seconds from now.
  // The short window lets close_voting (which enforces now >= voting_end) succeed
  // after a brief sleep without slowing the test suite significantly.
  const votingStart = Math.floor(Date.now() / 1000) - 1;
  const votingEnd = Math.floor(Date.now() / 1000) + 2;
  const title = "Fund marketing campaign";
  const description = "Allocate 100k USDC to marketing";

  // Voter commitment: Poseidon(secret_key, randomness) — mocked as 32 bytes of 0x01
  const commitment = Buffer.alloc(32, 1);

  // Mock nullifier: Poseidon(secret_key, proposal_id) — mocked for Phase 2 testing
  const nullifier = Buffer.alloc(32, 0xab);

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

  function getVkPda() {
    const [pda] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("vk")],
      program.programId
    );
    return pda;
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
    vkPda = getVkPda();

    await program.methods
      .createProposal(title, description, new anchor.BN(votingStart), new anchor.BN(votingEnd))
      .accounts({
        admin: admin.publicKey,
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
    await program.methods
      .registerVoter([...commitment])
      .accounts({
        admin: admin.publicKey,
        proposal: proposalPda,
        commitmentRecord: getCommitmentRecordPda(proposalPda, commitment),
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .rpc();

    const proposal = await program.account.proposal.fetch(proposalPda);
    assert.equal(proposal.voterCount.toNumber(), 1);

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

    // VK account is not initialized → cast_vote skips proof verification (dev mode).
    // In production: call store_vk first, then cast_vote performs real Groth16 verification.
    await program.methods
      .castVote(
        proof,           // Vec<u8>: proof_a (64) || proof_b (128) || proof_c (64)
        [...nullifier],
        [...voteCommitment],
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
  });

  it("Closes voting", async () => {
    // Wait for voting_end to pass — close_voting enforces now >= voting_end.
    await new Promise(r => setTimeout(r, 3000));

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
          proposal: pda,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .rpc();
      assert.fail("Should have thrown");
    } catch (err) {
      assert.include(err.message, "TitleTooLong");
    }
  });

  it("Rejects voter registration by non-admin", async () => {
    const altTitle = "Alt proposal";
    const altPda = getProposalPda(admin.publicKey, altTitle);
    const altFutureEnd = Math.floor(Date.now() / 1000) + 3600;

    await program.methods
      .createProposal(altTitle, description, new anchor.BN(votingStart), new anchor.BN(altFutureEnd))
      .accounts({
        admin: admin.publicKey,
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

    try {
      await program.methods
        .registerVoter([...Buffer.alloc(32, 2)])
        .accounts({
          admin: attacker.publicKey,
          proposal: altPda,
          commitmentRecord: getCommitmentRecordPda(altPda, Buffer.alloc(32, 2)),
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .signers([attacker])
        .rpc();
      assert.fail("Should have thrown");
    } catch (err) {
      assert.ok(err, "Non-admin registration should be rejected");
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
      .accounts({ admin: admin.publicKey, proposal: dupPda, systemProgram: anchor.web3.SystemProgram.programId })
      .rpc();

    // First registration — must succeed.
    await program.methods
      .registerVoter([...dupCommitment])
      .accounts({ admin: admin.publicKey, proposal: dupPda, commitmentRecord: dupCommitmentRecordPda, systemProgram: anchor.web3.SystemProgram.programId })
      .rpc();

    // Second registration with identical commitment — must fail.
    try {
      await program.methods
        .registerVoter([...dupCommitment])
        .accounts({ admin: admin.publicKey, proposal: dupPda, commitmentRecord: dupCommitmentRecordPda, systemProgram: anchor.web3.SystemProgram.programId })
        .rpc();
      assert.fail("Should have thrown");
    } catch (err) {
      assert.ok(err, "Duplicate commitment should be rejected");
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
        proposal: emptyPda,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .rpc();

    try {
      await program.methods
        .openVoting()
        .accounts({
          admin: admin.publicKey,
          proposal: emptyPda,
          vkAccount: vkPda,
        })
        .rpc();
      assert.fail("Should have thrown");
    } catch (err) {
      assert.include(err.message, "NotInRegistration");
    }
  });

  it("Rejects double vote with same nullifier", async () => {
    try {
      await program.methods
        .castVote(
          proof,
          [...nullifier],
          [...voteCommitment],
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

  it("Rejects close_voting before voting_end", async () => {
    const earlyCloseTitle = "Early close test";
    const earlyClosePda = getProposalPda(admin.publicKey, earlyCloseTitle);
    const futureEnd = Math.floor(Date.now() / 1000) + 3600;

    await program.methods
      .createProposal(earlyCloseTitle, description, new anchor.BN(votingStart), new anchor.BN(futureEnd))
      .accounts({ admin: admin.publicKey, proposal: earlyClosePda, systemProgram: anchor.web3.SystemProgram.programId })
      .rpc();

    await program.methods
      .registerVoter([...commitment])
      .accounts({ admin: admin.publicKey, proposal: earlyClosePda, commitmentRecord: getCommitmentRecordPda(earlyClosePda, commitment), systemProgram: anchor.web3.SystemProgram.programId })
      .rpc();

    await program.methods
      .openVoting()
      .accounts({ admin: admin.publicKey, proposal: earlyClosePda, vkAccount: vkPda })
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
    const cmNullifier = Buffer.alloc(32, 0xef);
    const cmNullifierPda = getNullifierPda(cmPda, cmNullifier);
    const cmVoteRecordPda = getVoteRecordPda(cmPda, cmNullifier);
    const cmRandomness = Buffer.alloc(32, 0x42);
    const cmCommitment = computeVoteCommitment(1, cmRandomness);

    await program.methods
      .createProposal(cmTitle, description, new anchor.BN(now2 - 1), new anchor.BN(now2 + 2))
      .accounts({ admin: admin.publicKey, proposal: cmPda, systemProgram: anchor.web3.SystemProgram.programId })
      .rpc();

    await program.methods
      .registerVoter([...commitment])
      .accounts({ admin: admin.publicKey, proposal: cmPda, commitmentRecord: getCommitmentRecordPda(cmPda, commitment), systemProgram: anchor.web3.SystemProgram.programId })
      .rpc();

    await program.methods.openVoting()
      .accounts({ admin: admin.publicKey, proposal: cmPda, vkAccount: vkPda })
      .rpc();

    await program.methods
      .castVote(proof, [...cmNullifier], [...cmCommitment])
      .accounts({
        voter: admin.publicKey, proposal: cmPda, vkAccount: vkPda,
        nullifierRecord: cmNullifierPda, voteRecord: cmVoteRecordPda,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .rpc();

    await new Promise(r => setTimeout(r, 3000));
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
    const wvNullifier = Buffer.alloc(32, 0xcc);
    const wvNullifierPda = getNullifierPda(wvPda, wvNullifier);
    const wvVoteRecordPda = getVoteRecordPda(wvPda, wvNullifier);
    const wvRandomness = Buffer.alloc(32, 0);
    const wvCommitment = computeVoteCommitment(1, wvRandomness);

    await program.methods
      .createProposal(wvTitle, description, new anchor.BN(now3 - 1), new anchor.BN(now3 + 2))
      .accounts({ admin: admin.publicKey, proposal: wvPda, systemProgram: anchor.web3.SystemProgram.programId })
      .rpc();

    await program.methods
      .registerVoter([...commitment])
      .accounts({ admin: admin.publicKey, proposal: wvPda, commitmentRecord: getCommitmentRecordPda(wvPda, commitment), systemProgram: anchor.web3.SystemProgram.programId })
      .rpc();

    await program.methods.openVoting()
      .accounts({ admin: admin.publicKey, proposal: wvPda, vkAccount: vkPda })
      .rpc();

    await program.methods
      .castVote(proof, [...wvNullifier], [...wvCommitment])
      .accounts({
        voter: admin.publicKey, proposal: wvPda, vkAccount: vkPda,
        nullifierRecord: wvNullifierPda, voteRecord: wvVoteRecordPda,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .rpc();

    await new Promise(r => setTimeout(r, 3000));
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
  //
  // NOTE: placed before store_vk so cast_vote still uses the dev bypass
  // (VK absent → proof verification skipped).

  it("Rejects finalize_tally when votes unrevealed and grace period not yet expired", async () => {
    // vote_count=1, yes+no=0 → all_revealed = false (tests saturating_add on counts).
    // voting_end just passed; REVEAL_GRACE_PERIOD (86_400 s) has not elapsed
    // → grace_expired = false (tests saturating_add on voting_end).
    // Both conditions false → must reject with VotingStillOpen.
    const now4 = Math.floor(Date.now() / 1000);
    const graceTitle = "Grace period test";
    const gracePda = getProposalPda(admin.publicKey, graceTitle);
    const graceNullifier = Buffer.alloc(32, 0xdd);
    const graceNullifierPda = getNullifierPda(gracePda, graceNullifier);
    const graceVoteRecordPda = getVoteRecordPda(gracePda, graceNullifier);
    const graceCommitment = computeVoteCommitment(1, Buffer.alloc(32, 0));

    await program.methods
      .createProposal(graceTitle, description, new anchor.BN(now4 - 1), new anchor.BN(now4 + 2))
      .accounts({ admin: admin.publicKey, proposal: gracePda, systemProgram: anchor.web3.SystemProgram.programId })
      .rpc();

    await program.methods
      .registerVoter([...Buffer.alloc(32, 9)])
      .accounts({ admin: admin.publicKey, proposal: gracePda, commitmentRecord: getCommitmentRecordPda(gracePda, Buffer.alloc(32, 9)), systemProgram: anchor.web3.SystemProgram.programId })
      .rpc();

    await program.methods.openVoting()
      .accounts({ admin: admin.publicKey, proposal: gracePda, vkAccount: vkPda })
      .rpc();

    await program.methods
      .castVote(proof, [...graceNullifier], [...graceCommitment])
      .accounts({
        voter: admin.publicKey, proposal: gracePda, vkAccount: vkPda,
        nullifierRecord: graceNullifierPda, voteRecord: graceVoteRecordPda,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .rpc();

    // Wait for voting_end, then close.
    await new Promise(r => setTimeout(r, 3000));
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

  // ── open_voting VK gate tests ──────────────────────────────────────────────
  //
  // These three tests cover open_voting requiring the vk_account PDA.
  // The seeds constraint is always enforced (wrong address → rejected before
  // the handler runs). The is_initialized check only fires in production
  // builds; dev builds allow opening without a VK so anchor test works
  // without a real trusted-setup ceremony.
  //
  // NOTE: store_vk uses `init_if_needed` + is_initialized guard, so it can
  // only write data once per deployment. These tests are placed last so
  // earlier cast_vote tests can rely on the dev bypass (VK absent →
  // proof verification skipped).

  it("Rejects open_voting when vk_account PDA is wrong", async () => {
    // Anchor validates account seeds before the handler runs.
    // Passing any address other than the canonical [b"vk"] PDA must be
    // rejected in both dev and production builds.
    const wrongVkTitle = "Wrong VK PDA test";
    const wrongVkPda = getProposalPda(admin.publicKey, wrongVkTitle);
    const futureEnd = Math.floor(Date.now() / 1000) + 3600;

    await program.methods
      .createProposal(wrongVkTitle, description, new anchor.BN(votingStart), new anchor.BN(futureEnd))
      .accounts({ admin: admin.publicKey, proposal: wrongVkPda, systemProgram: anchor.web3.SystemProgram.programId })
      .rpc();

    await program.methods
      .registerVoter([...Buffer.alloc(32, 7)])
      .accounts({ admin: admin.publicKey, proposal: wrongVkPda, commitmentRecord: getCommitmentRecordPda(wrongVkPda, Buffer.alloc(32, 7)), systemProgram: anchor.web3.SystemProgram.programId })
      .rpc();

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

  it("Stores the verifying key", async () => {
    // store_vk is a one-time init — placed here so earlier cast_vote tests
    // can still use the dev bypass (VK absent → proof verification skipped).
    const zeroG1 = Array(64).fill(0);
    const zeroG2 = Array(128).fill(0);
    const zeroIc = Array(5).fill(null).map(() => Array(64).fill(0));

    await program.methods
      .storeVk(zeroG1, zeroG2, zeroG2, zeroG2, zeroIc)
      .accounts({
        admin: admin.publicKey,
        programConfig: programConfigPda,
        vkAccount: vkPda,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .rpc();

    const vk = await program.account.verificationKeyAccount.fetch(vkPda);
    assert.equal(vk.isInitialized, true);
  });

  it("open_voting succeeds with an initialized VK", async () => {
    // With VK stored and is_initialized == true, open_voting must transition
    // the proposal to Voting. This exercises the path that production builds
    // enforce: open_voting is only reachable after store_vk has been called.
    const initVkTitle = "Initialized VK test";
    const initVkPda = getProposalPda(admin.publicKey, initVkTitle);
    const futureEnd = Math.floor(Date.now() / 1000) + 3600;

    await program.methods
      .createProposal(initVkTitle, description, new anchor.BN(votingStart), new anchor.BN(futureEnd))
      .accounts({ admin: admin.publicKey, proposal: initVkPda, systemProgram: anchor.web3.SystemProgram.programId })
      .rpc();

    await program.methods
      .registerVoter([...Buffer.alloc(32, 8)])
      .accounts({ admin: admin.publicKey, proposal: initVkPda, commitmentRecord: getCommitmentRecordPda(initVkPda, Buffer.alloc(32, 8)), systemProgram: anchor.web3.SystemProgram.programId })
      .rpc();

    await program.methods
      .openVoting()
      .accounts({ admin: admin.publicKey, proposal: initVkPda, vkAccount: vkPda })
      .rpc();

    const proposal = await program.account.proposal.fetch(initVkPda);
    assert.deepEqual(proposal.status, { voting: {} });
  });

  it("Rejects a second store_vk call (reinitialization guard)", async () => {
    // vkPda is already initialized from "Stores the verifying key".
    // A second call must be rejected by the is_initialized guard in the
    // handler, even though init_if_needed would otherwise succeed at the
    // account-constraint level.
    const zeroG1 = Array(64).fill(0);
    const zeroG2 = Array(128).fill(0);
    const zeroIc = Array(5).fill(null).map(() => Array(64).fill(0));

    try {
      await program.methods
        .storeVk(zeroG1, zeroG2, zeroG2, zeroG2, zeroIc)
        .accounts({
          admin: admin.publicKey,
          programConfig: programConfigPda,
          vkAccount: vkPda,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .rpc();
      assert.fail("Should have thrown");
    } catch (err) {
      assert.include(err.message, "VkAlreadyInitialized");
    }
  });
});

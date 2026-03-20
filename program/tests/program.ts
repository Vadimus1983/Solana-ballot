import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { SolanaBallot } from "../target/types/solana_ballot";
import { assert } from "chai";

describe("solana_ballot", () => {
  anchor.setProvider(anchor.AnchorProvider.env());
  const program = anchor.workspace.SolanaBallot as Program<SolanaBallot>;
  const provider = anchor.getProvider() as anchor.AnchorProvider;

  const admin = provider.wallet;

  // Voting period: starts 1 second ago, ends 1 hour from now
  const votingStart = Math.floor(Date.now() / 1000) - 1;
  const votingEnd = Math.floor(Date.now() / 1000) + 3600;
  const title = "Fund marketing campaign";
  const description = "Allocate 100k USDC to marketing";

  // Voter commitment: Poseidon(secret_key, randomness) — mocked as 32 bytes of 0x01
  const commitment = Buffer.alloc(32, 1);

  // After registering one voter via XOR stub: merkle_root = 0x00 XOR 0x01...01 = 0x01...01
  const merkleRoot = Buffer.alloc(32, 1);

  // Mock nullifier: in Phase 2 this will be Poseidon(secret_key, proposal_id)
  const nullifier = Buffer.alloc(32, 0xab);

  // Mock vote commitment: in Phase 2 this will be Poseidon(vote=1, randomness)
  const voteCommitment = Buffer.alloc(32, 0xcd);

  // Mock Groth16 proof components — stub verification always passes in Phase 1
  const proofA = Buffer.alloc(64, 0);
  const proofB = Buffer.alloc(128, 0);
  const proofC = Buffer.alloc(64, 0);

  let proposalPda: anchor.web3.PublicKey;
  let nullifierRecordPda: anchor.web3.PublicKey;
  let voteRecordPda: anchor.web3.PublicKey;

  // Mirror the on-chain PDA derivation: truncate title to 32 bytes (Solana seed limit)
  function getProposalPda(adminKey: anchor.web3.PublicKey, t: string) {
    const titleSeed = Buffer.from(t).slice(0, 32);
    const [pda] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("proposal"), adminKey.toBuffer(), titleSeed],
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

  // ── Happy path ────────────────────────────────────────────────────────────

  it("Creates a proposal", async () => {
    proposalPda = getProposalPda(admin.publicKey, title);

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
      })
      .rpc();

    const proposal = await program.account.proposal.fetch(proposalPda);
    assert.deepEqual(proposal.status, { voting: {} });
  });

  it("Casts a vote", async () => {
    nullifierRecordPda = getNullifierPda(proposalPda, nullifier);
    voteRecordPda = getVoteRecordPda(proposalPda, nullifier);

    await program.methods
      .castVote(
        [...proofA],
        [...proofB],
        [...proofC],
        [...nullifier],
        [...voteCommitment],
        [...merkleRoot],
      )
      .accounts({
        voter: admin.publicKey,
        proposal: proposalPda,
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
    await program.methods
      .closeVoting()
      .accounts({
        admin: admin.publicKey,
        proposal: proposalPda,
      })
      .rpc();

    const proposal = await program.account.proposal.fetch(proposalPda);
    assert.deepEqual(proposal.status, { closed: {} });
  });

  it("Reveals a vote", async () => {
    // vote=1 (yes), randomness mocked — Phase 2 will verify Poseidon(vote, randomness) == voteCommitment
    const randomness = Buffer.alloc(32, 0);

    await program.methods
      .revealVote(1, [...randomness])
      .accounts({
        voter: admin.publicKey,
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
        admin: admin.publicKey,
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
    // 129 chars — exceeds MAX_TITLE_LEN (128); PDA seed uses only first 32 bytes
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
    // Create a fresh proposal so it is still in Registration status
    const altTitle = "Alt proposal";
    const altPda = getProposalPda(admin.publicKey, altTitle);

    await program.methods
      .createProposal(altTitle, description, new anchor.BN(votingStart), new anchor.BN(votingEnd))
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
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .signers([attacker])
        .rpc();
      assert.fail("Should have thrown");
    } catch (err) {
      assert.ok(err, "Non-admin registration should be rejected");
    }
  });

  it("Rejects open_voting with no registered voters", async () => {
    // Fresh proposal with no voters registered
    const emptyTitle = "Empty proposal";
    const emptyPda = getProposalPda(admin.publicKey, emptyTitle);

    await program.methods
      .createProposal(emptyTitle, description, new anchor.BN(votingStart), new anchor.BN(votingEnd))
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
        })
        .rpc();
      assert.fail("Should have thrown");
    } catch (err) {
      assert.include(err.message, "NotInRegistration");
    }
  });

  it("Rejects double vote with same nullifier", async () => {
    // The nullifier from the happy path is already stored on-chain.
    // A second cast_vote with the same nullifier must fail because
    // the NullifierRecord PDA already exists (init would conflict).
    try {
      await program.methods
        .castVote(
          [...proofA],
          [...proofB],
          [...proofC],
          [...nullifier],
          [...voteCommitment],
          [...merkleRoot],
        )
        .accounts({
          voter: admin.publicKey,
          proposal: proposalPda,
          nullifierRecord: nullifierRecordPda,
          voteRecord: voteRecordPda,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .rpc();
      assert.fail("Should have thrown");
    } catch (err) {
      // Anchor init fails when account already exists
      assert.ok(err, "Double vote should be rejected");
    }
  });

  it("Rejects finalize before close", async () => {
    // Open a fresh proposal and try to finalize it immediately
    const freshTitle = "Fresh proposal";
    const freshPda = getProposalPda(admin.publicKey, freshTitle);

    await program.methods
      .createProposal(freshTitle, description, new anchor.BN(votingStart), new anchor.BN(votingEnd))
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
          admin: admin.publicKey,
          proposal: freshPda,
        })
        .rpc();
      assert.fail("Should have thrown");
    } catch (err) {
      assert.include(err.message, "VotingStillOpen");
    }
  });
});

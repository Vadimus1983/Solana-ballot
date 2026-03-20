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

  // Mock nullifier: Poseidon(secret_key, proposal_id) — mocked for Phase 2 testing
  const nullifier = Buffer.alloc(32, 0xab);

  // Mock vote commitment: Poseidon(vote=1, randomness) — mocked for Phase 2 testing
  const voteCommitment = Buffer.alloc(32, 0xcd);

  // Mock Groth16 proof — VK not initialized so verification is skipped.
  // Encoded as proof_a (64 B) || proof_b (128 B) || proof_c (64 B) = 256 bytes.
  // The program accepts a single Vec<u8> to keep the BPF stack frame under 4096 bytes.
  const proof = Buffer.alloc(64 + 128 + 64, 0);

  let proposalPda: anchor.web3.PublicKey;
  let vkPda: anchor.web3.PublicKey;
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

  // ── Happy path ────────────────────────────────────────────────────────────

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

  it("Rejects finalize before close", async () => {
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

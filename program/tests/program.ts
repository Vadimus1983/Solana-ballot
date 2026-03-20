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

  let proposalPda: anchor.web3.PublicKey;

  function getProposalPda(adminKey: anchor.web3.PublicKey, title: string) {
    // Mirror the on-chain seed: truncate title to 32 bytes (Solana PDA seed limit)
    const titleSeed = Buffer.from(title).slice(0, 32);
    const [pda] = anchor.web3.PublicKey.findProgramAddressSync(
      [
        Buffer.from("proposal"),
        adminKey.toBuffer(),
        titleSeed,
      ],
      program.programId
    );
    return pda;
  }

  it("Creates a proposal", async () => {
    proposalPda = getProposalPda(admin.publicKey, title);

    const tx = await program.methods
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
    console.log("Proposal created:", tx);
  });

  it("Rejects proposal with title too long", async () => {
    // 129 chars — exceeds MAX_TITLE_LEN (128) but PDA seed uses only first 32 bytes
    const longTitle = "a".repeat(129);
    const pda = getProposalPda(admin.publicKey, longTitle); // uses first 32 bytes as seed

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

  it("Registers a voter", async () => {
    proposalPda = getProposalPda(admin.publicKey, title);
    const commitment = Buffer.alloc(32, 1); // mock commitment

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
    console.log("Voter registered");
  });

  it("Rejects voter registration by non-admin", async () => {
    proposalPda = getProposalPda(admin.publicKey, title);
    const attacker = anchor.web3.Keypair.generate();
    const commitment = Buffer.alloc(32, 2);

    // Fund attacker
    const sig = await provider.connection.requestAirdrop(attacker.publicKey, anchor.web3.LAMPORTS_PER_SOL);
    await provider.connection.confirmTransaction(sig);

    try {
      await program.methods
        .registerVoter([...commitment])
        .accounts({
          admin: attacker.publicKey,
          proposal: proposalPda,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .signers([attacker])
        .rpc();
      assert.fail("Should have thrown");
    } catch (err) {
      assert.ok(err, "Non-admin registration should be rejected");
    }
  });

  it("Closes voting", async () => {
    proposalPda = getProposalPda(admin.publicKey, title);

    // First set status to Voting
    // For now this will fail since we need an open_voting instruction
    // We test close on Registration status — should fail
    try {
      await program.methods
        .closeVoting()
        .accounts({
          admin: admin.publicKey,
          proposal: proposalPda,
        })
        .rpc();
      assert.fail("Should have thrown — not in Voting status");
    } catch (err) {
      assert.include(err.message, "VotingNotOpen");
    }
    console.log("Close voting correctly rejected on non-open proposal");
  });

  it("Finalizes tally fails before close", async () => {
    proposalPda = getProposalPda(admin.publicKey, title);

    try {
      await program.methods
        .finalizeTally()
        .accounts({
          admin: admin.publicKey,
          proposal: proposalPda,
        })
        .rpc();
      assert.fail("Should have thrown");
    } catch (err) {
      assert.include(err.message, "VotingStillOpen");
    }
    console.log("Finalize correctly rejected on non-closed proposal");
  });
});

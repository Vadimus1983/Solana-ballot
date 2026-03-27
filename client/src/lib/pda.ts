import { PublicKey } from "@solana/web3.js";
import { keccak_256 } from "@noble/hashes/sha3";

export const PROGRAM_ID = new PublicKey(
  "2h52sCAKhKtBFdyTfa3XamcWXkZB6M3D7XknNNfkQivZ"
);

/** Global PDA for ProgramConfig — seeds: ["config"]. */
export function getConfigPda(): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from("config")],
    PROGRAM_ID
  );
  return pda;
}

/** Mirrors the on-chain seed: Keccak-256 of the full title. */
export function getProposalPda(admin: PublicKey, title: string): PublicKey {
  const titleHash = Buffer.from(keccak_256(Buffer.from(title)));
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from("proposal"), admin.toBuffer(), titleHash],
    PROGRAM_ID
  );
  return pda;
}

/** Per-proposal root history PDA — seeds: ["root_history", proposal]. */
export function getRootHistoryPda(proposal: PublicKey): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from("root_history"), proposal.toBuffer()],
    PROGRAM_ID
  );
  return pda;
}

/** Per-proposal VK PDA — seeds: ["vk", proposal]. */
export function getVkPda(proposal: PublicKey): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from("vk"), proposal.toBuffer()],
    PROGRAM_ID
  );
  return pda;
}

/** Temporary commitment PDA created by voter — seeds: ["pending_commitment", proposal, voter]. */
export function getPendingCommitmentPda(
  proposal: PublicKey,
  voter: PublicKey
): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from("pending_commitment"), proposal.toBuffer(), voter.toBuffer()],
    PROGRAM_ID
  );
  return pda;
}

export function getNullifierPda(
  proposal: PublicKey,
  nullifier: Uint8Array
): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from("nullifier"), proposal.toBuffer(), Buffer.from(nullifier)],
    PROGRAM_ID
  );
  return pda;
}

export function getVoteRecordPda(
  proposal: PublicKey,
  nullifier: Uint8Array
): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from("vote"), proposal.toBuffer(), Buffer.from(nullifier)],
    PROGRAM_ID
  );
  return pda;
}

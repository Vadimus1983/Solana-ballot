import { PublicKey } from "@solana/web3.js";
import { keccak_256 } from "@noble/hashes/sha3";

export const PROGRAM_ID = new PublicKey(
  "2h52sCAKhKtBFdyTfa3XamcWXkZB6M3D7XknNNfkQivZ"
);

/** Mirrors the on-chain seed: Keccak-256 of the full title (MEDIUM-3 fix). */
export function getProposalPda(admin: PublicKey, title: string): PublicKey {
  const titleHash = Buffer.from(keccak_256(Buffer.from(title)));
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from("proposal"), admin.toBuffer(), titleHash],
    PROGRAM_ID
  );
  return pda;
}

/** Single global VK PDA — one per program deployment. */
export function getVkPda(): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from("vk")],
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

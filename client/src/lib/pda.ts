import { PublicKey } from "@solana/web3.js";

export const PROGRAM_ID = new PublicKey(
  "2h52sCAKhKtBFdyTfa3XamcWXkZB6M3D7XknNNfkQivZ"
);

/** Mirrors the on-chain seed: title is truncated to 32 bytes (Solana seed limit). */
export function getProposalPda(admin: PublicKey, title: string): PublicKey {
  const titleSeed = Buffer.from(title).slice(0, 32);
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from("proposal"), admin.toBuffer(), titleSeed],
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

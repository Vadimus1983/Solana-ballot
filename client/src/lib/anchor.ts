import { Connection } from "@solana/web3.js";
import { AnchorProvider, Program } from "@coral-xyz/anchor";
import type { AnchorWallet } from "@solana/wallet-adapter-react";
import IDL from "../solana_ballot.json";
import type { SolanaBallot } from "../solana_ballot";

export function getProgram(
  connection: Connection,
  wallet: AnchorWallet
): Program<SolanaBallot> {
  const provider = new AnchorProvider(connection, wallet, {
    commitment: "confirmed",
  });
  return new Program(IDL as unknown as SolanaBallot, provider);
}

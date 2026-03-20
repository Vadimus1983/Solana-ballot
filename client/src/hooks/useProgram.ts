import { useMemo } from "react";
import { useConnection, useAnchorWallet } from "@solana/wallet-adapter-react";
import { Program } from "@coral-xyz/anchor";
import { getProgram } from "../lib/anchor";
import type { SolanaBallot } from "../solana_ballot";

export function useProgram(): Program<SolanaBallot> | null {
  const { connection } = useConnection();
  const wallet = useAnchorWallet();
  return useMemo(
    () => (wallet ? getProgram(connection, wallet) : null),
    [connection, wallet]
  );
}

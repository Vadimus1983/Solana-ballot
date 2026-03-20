import { useEffect, useState, useCallback } from "react";
import { PublicKey } from "@solana/web3.js";
import { useProgram } from "./useProgram";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type ProposalAccount = any;

export function useProposal(proposalPda: PublicKey | null): {
  proposal: ProposalAccount | null;
  loading: boolean;
  error: string | null;
  refresh: () => void;
} {
  const program = useProgram();
  const [proposal, setProposal] = useState<ProposalAccount | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetch = useCallback(async () => {
    if (!program || !proposalPda) return;
    setLoading(true);
    setError(null);
    try {
      const data = await program.account.proposal.fetch(proposalPda);
      setProposal(data);
    } catch (e: unknown) {
      setProposal(null);
      setError(e instanceof Error ? e.message : "Failed to fetch proposal");
    } finally {
      setLoading(false);
    }
  }, [program, proposalPda]);

  useEffect(() => {
    fetch();
    const id = setInterval(fetch, 5000);
    return () => clearInterval(id);
  }, [fetch]);

  return { proposal, loading, error, refresh: fetch };
}

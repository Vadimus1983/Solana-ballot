import { useEffect, useState, useCallback, useRef } from "react";
import { PublicKey } from "@solana/web3.js";
import { useConnection } from "@solana/wallet-adapter-react";
import { useProgram } from "./useProgram";
import { notifyStatusChange } from "../lib/notifications";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type ProposalAccount = any;

export function useProposal(proposalPda: PublicKey | null): {
  proposal: ProposalAccount | null;
  loading: boolean;
  error: string | null;
  refresh: () => void;
} {
  const program = useProgram();
  const { connection } = useConnection();
  const [proposal, setProposal] = useState<ProposalAccount | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Track the last known status so we can detect phase transitions.
  // Using a ref (not state) so the effect closure always sees the current value
  // without needing to be in the dependency array.
  const prevStatusRef = useRef<string | null>(null);

  const fetch = useCallback(async () => {
    if (!program || !proposalPda) return;
    setLoading(true);
    setError(null);
    try {
      const data = await program.account.proposal.fetch(proposalPda);
      const newStatus: string = Object.keys(data.status)[0];

      // Fire a browser notification whenever the phase advances.
      // Skip on the very first fetch (prevStatus is null) so we don't spam
      // a notification for the current state when the page loads.
      if (prevStatusRef.current !== null && prevStatusRef.current !== newStatus) {
        notifyStatusChange(newStatus);
      }
      prevStatusRef.current = newStatus;

      setProposal(data);
    } catch (e: unknown) {
      setProposal(null);
      setError(e instanceof Error ? e.message : "Failed to fetch proposal");
    } finally {
      setLoading(false);
    }
  }, [program, proposalPda]);

  // WebSocket subscription — fires fetch() on every on-chain account change.
  // This gives real-time updates (sub-second after finality) without a backend.
  // The subscription is torn down and re-created whenever proposalPda changes.
  useEffect(() => {
    if (!proposalPda || !connection) return;

    const subId = connection.onAccountChange(
      proposalPda,
      () => { fetch(); },
      "confirmed",
    );

    return () => {
      connection.removeAccountChangeListener(subId);
    };
  }, [connection, proposalPda, fetch]);

  // Initial fetch on mount + 30-second fallback poll.
  // The poll is a safety net for dropped WebSocket connections; the primary
  // update path is the account-change subscription above.
  useEffect(() => {
    fetch();
    const id = setInterval(fetch, 30_000);
    return () => clearInterval(id);
  }, [fetch]);

  return { proposal, loading, error, refresh: fetch };
}
